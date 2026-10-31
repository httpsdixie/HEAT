#!/bin/sh
set -eu

cd "$(dirname "$0")"

start_logger() {
    echo "Starting ORCHID serial logger..."
    (while true; do
        python3 DB/logger.py
        echo "Logger stopped. Restarting in 5 seconds..."
        sleep 5
    done) &
    echo "Logger running (PID $!)"
}

if [ ! -d demo ]; then
    start_logger
    exec python3 scripts/serve.py "$@"
fi

for argument in "$@"; do
    if [ "$argument" = "--mock-data" ]; then
        exec python3 scripts/serve.py "$@"
    fi
done

if command -v zenity >/dev/null 2>&1; then
    choice=$(zenity --list --radiolist \
        --title="ORCHID" \
        --text="Choose which data source to open:" \
        --column="" --column="Data source" \
        TRUE "Real sensor database" FALSE "Demo data" \
        --width=420 --height=230) || exit 0
elif [ -t 0 ]; then
    printf 'Choose ORCHID data source:\n1) Real sensor database\n2) Demo data\nSelection [1/2]: '
    read -r choice
    case "$choice" in
        1) choice="Real sensor database" ;;
        2) choice="Demo data" ;;
        *) printf 'No valid selection. ORCHID was not started.\n' >&2; exit 1 ;;
    esac
else
    printf 'A graphical chooser (zenity) is needed to launch ORCHID. Install zenity or start this script from a terminal.\n' >&2
    exit 1
fi

case "$choice" in
    "Real sensor database")
        start_logger
        exec python3 scripts/serve.py "$@"
        ;;
    "Demo data") exec python3 scripts/serve.py --mock-data "$@" ;;
    *) exit 0 ;;
esac
