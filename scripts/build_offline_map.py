"""Fetch and bundle Ormoc map data once; the dashboard then works without internet.

Run from the project root with: python3 scripts/build_offline_map.py
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


BOUNDS = (124.47, 10.87, 124.79, 11.16)
OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "js" / "ormoc-map-data.js"
BUILDING_OUTPUT_PATH = Path(__file__).resolve().parent.parent / "js" / "ormoc-building-data.js"


def fetch_overpass(bounds, retries=3, delay=15):
    west, south, east, north = bounds
    bbox = f"{south},{west},{north},{east}"
    query = f"""
[out:xml][timeout:120];
(
  way["highway"]({bbox});
  way["waterway"]({bbox});
  way["railway"]({bbox});
  way["building"]({bbox});
  way["landuse"]({bbox});
  way["leisure"]({bbox});
  way["natural"~"coastline|water|wetland|beach"]({bbox});
  node["place"~"city|town|village|suburb|neighbourhood"]({bbox});
);
out body;
>;
out skel qt;
""".strip()

    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(1, retries + 1):
        for url in OVERPASS_SERVERS:
            try:
                request = urllib.request.Request(
                    url,
                    data=data,
                    headers={"User-Agent": "ORCHID offline map data builder"},
                )
                with urllib.request.urlopen(request, timeout=180) as response:
                    return ET.fromstring(response.read())
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as err:
                print(f"  {url} failed: {err}")
        if attempt < retries:
            print(f"  All servers failed, waiting {delay}s before retry {attempt + 1}/{retries}...")
            time.sleep(delay)
    raise RuntimeError(f"All Overpass servers failed for bbox {bbox} after {retries} attempts.")


def is_map_feature(tags):
    return any(
        key in tags
        for key in ("highway", "waterway", "railway", "building", "landuse", "leisure")
    ) or tags.get("natural") in {"coastline", "water", "wetland", "beach"}


def build_features(root, bounds):
    west, south, east, north = bounds
    nodes = {}
    for node in root.findall("node"):
        nodes[node.get("id")] = node

    features = []
    buildings = []

    for way in root.findall("way"):
        tags = {tag.get("k"): tag.get("v") for tag in way.findall("tag")}
        if not is_map_feature(tags):
            continue

        coordinates = []
        for reference in way.findall("nd"):
            node = nodes.get(reference.get("ref"))
            if node is not None and node.get("lat") is not None and node.get("lon") is not None:
                coordinates.append([float(node.get("lon")), float(node.get("lat"))])
        if len(coordinates) < 2:
            continue

        is_area = coordinates[0] == coordinates[-1] and (
            any(key in tags for key in ("building", "landuse", "leisure")) or
            tags.get("natural") == "water" or tags.get("waterway") == "riverbank"
        )
        geometry = {
            "type": "Polygon" if is_area else "LineString",
            "coordinates": [coordinates] if is_area else coordinates,
        }
        properties = {
            key: tags[key]
            for key in (
                "highway", "waterway", "railway", "building", "landuse", "leisure",
                "natural", "name", "place", "amenity", "water",
            )
            if key in tags
        }
        feature = {"type": "Feature", "properties": properties, "geometry": geometry}
        if tags.get("building"):
            buildings.append(feature)
        else:
            features.append(feature)

    for node in root.findall("node"):
        tags = {tag.get("k"): tag.get("v") for tag in node.findall("tag")}
        if tags.get("place") not in {"city", "town", "village", "suburb", "neighbourhood"}:
            continue
        lat, lon = float(node.get("lat")), float(node.get("lon"))
        if west <= lon <= east and south <= lat <= north:
            features.append({
                "type": "Feature",
                "properties": {"place": tags["place"], "name": tags.get("name", "")},
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            })

    return features, buildings


def write_bundle(path, variable, features):
    serialized_features = (
        "    " + json.dumps(feature, ensure_ascii=False, separators=(",", ":"))
        for feature in features
    )
    output = (
        f"window.{variable} = {{\"type\":\"FeatureCollection\",\"features\":[\n"
        + ",\n".join(serialized_features)
        + "\n]};\n"
    )
    path.write_text(output, encoding="utf-8")
    return len(output)


def main():
    west, south, east, north = BOUNDS
    mid_lng = (west + east) / 2
    mid_lat = (south + north) / 2

    # Split into 4 quadrants to keep each request small enough
    quadrants = [
        (west,    south,   mid_lng, mid_lat),
        (mid_lng, south,   east,    mid_lat),
        (west,    mid_lat, mid_lng, north),
        (mid_lng, mid_lat, east,    north),
    ]

    all_nodes = {}
    all_ways = {}

    for i, quad in enumerate(quadrants, 1):
        cache_path = Path(f"/tmp/orchid_quad_{i}.xml")
        if cache_path.exists():
            print(f"Quadrant {i}/4: using cached data from {cache_path}")
            root = ET.parse(cache_path).getroot()
        else:
            print(f"Fetching quadrant {i}/4: {quad}")
            root = fetch_overpass(quad)
            cache_path.write_bytes(ET.tostring(root))

        for node in root.findall("node"):
            all_nodes[node.get("id")] = node
        for way in root.findall("way"):
            all_ways[way.get("id")] = way
        print(f"  Got {len(root.findall('node'))} nodes, {len(root.findall('way'))} ways")

    print(f"Total: {len(all_nodes)} nodes, {len(all_ways)} ways — building features...")

    # Build a synthetic root with merged elements
    synthetic = ET.Element("osm")
    for node in all_nodes.values():
        synthetic.append(node)
    for way in all_ways.values():
        synthetic.append(way)

    features, buildings = build_features(synthetic, BOUNDS)
    map_size = write_bundle(OUTPUT_PATH, "ORCHID_OFFLINE_MAP", features)
    building_size = write_bundle(BUILDING_OUTPUT_PATH, "ORCHID_OFFLINE_BUILDINGS", buildings)

    # Clean up cache files
    for i in range(1, 5):
        Path(f"/tmp/orchid_quad_{i}.xml").unlink(missing_ok=True)

    print(
        f"Wrote {len(features)} map features ({map_size/1024/1024:.2f} MB) and "
        f"{len(buildings)} detailed buildings ({building_size/1024:.0f} KB)"
    )


if __name__ == "__main__":
    main()
