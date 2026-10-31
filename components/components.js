/**
 * components/components.js
 * Universal Component Loader & Lifecycle Controller
 * Loads redundant design components (sidebar, header, toasts, modals) across all views.
 * Adheres strictly to PROJECT_RULES.md
 */

// Global Toast Controller
window.OrchidToast = {
  stackLimit: 3,

  show(options) {
    const { variant = 'info', title = '', message = '', duration = 5000 } = options;
    const stack = document.getElementById('toast-stack');
    if (!stack) return;

    // Enforce max 3 stacked toasts
    const currentToasts = stack.querySelectorAll('.orchid-toast');
    if (currentToasts.length >= this.stackLimit) {
      currentToasts[0].remove();
    }

    const toast = document.createElement('div');
    toast.className = `orchid-toast toast-${variant}`;
    toast.setAttribute('role', 'status');

    let iconSvg = '';
    if (variant === 'success') {
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    } else if (variant === 'error') {
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
    } else if (variant === 'warning') {
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    } else {
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    toast.innerHTML = `
      <div class="toast-icon-wrap">${iconSvg}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${title}</div>` : ''}
        <div class="toast-msg">${message}</div>
      </div>
      <button class="toast-dismiss-btn" aria-label="Dismiss notification">&times;</button>
    `;

    toast.querySelector('.toast-dismiss-btn').addEventListener('click', () => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 200);
    });

    stack.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        if (toast.isConnected) {
          toast.classList.add('fade-out');
          setTimeout(() => toast.remove(), 250);
        }
      }, duration);
    }
  }
};

// Global Modal Controller
window.OrchidModal = {
  backdrop: null,
  activeElementBeforeOpen: null,

  init() {
    this.backdrop = document.getElementById('orchid-modal-backdrop');
    if (!this.backdrop) return;

    const closeBtn = document.getElementById('orchid-modal-close');
    const cancelBtn = document.getElementById('orchid-modal-btn-cancel');

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());

    // Backdrop click dismisses modal
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) {
        this.close();
      }
    });

    // ESC key dismisses modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });
  },

  isOpen() {
    return this.backdrop && this.backdrop.style.display !== 'none';
  },

  open(options) {
    if (!this.backdrop) this.init();
    if (!this.backdrop) return;

    this.activeElementBeforeOpen = document.activeElement;

    const titleEl   = document.getElementById('orchid-modal-title');
    const bodyEl    = document.getElementById('orchid-modal-body');
    const actionBtn = document.getElementById('orchid-modal-btn-action');
    const cancelBtn = document.getElementById('orchid-modal-btn-cancel');
    const closeBtn  = document.getElementById('orchid-modal-close');
    const dialog    = document.getElementById('orchid-modal-dialog');
    const footer    = document.getElementById('orchid-modal-footer');

    if (footer) footer.style.display = options.hideFooter ? 'none' : '';

    if (titleEl && options.title) titleEl.textContent = options.title;
    if (bodyEl && options.bodyHtml) bodyEl.innerHTML = options.bodyHtml;

    // Always refresh close button handler so it's never stale
    if (closeBtn) closeBtn.onclick = () => this.close();

    // Wide variant for content-heavy modals
    if (dialog) {
      dialog.classList.toggle('modal-dialog--wide', !!options.wide);
      dialog.classList.toggle('modal-dialog--account-settings', !!options.accountSettings);
      dialog.classList.toggle('modal-dialog--profile-edit', !!options.profileEdit);
    }

    if (actionBtn) {
      actionBtn.textContent = options.confirmText || 'Confirm';
      actionBtn.className = options.isDestructive ? 'btn btn-danger' : 'btn btn-primary';
      actionBtn.onclick = () => {
        if (typeof options.onConfirm === 'function') {
          options.onConfirm();
        }
        this.close();
      };
    }

    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || 'Close';
    }

    this.backdrop.style.display = 'flex';
    this.backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    setTimeout(() => {
      if (actionBtn) actionBtn.focus();
    }, 50);
  },

  close() {
    if (!this.backdrop) return;
    this.backdrop.style.display = 'none';
    this.backdrop.setAttribute('aria-hidden', 'true');
    document.getElementById('orchid-modal-dialog')?.classList.remove('modal-dialog--profile-edit');
    if (!document.querySelector('.profile-modal-backdrop:not([hidden])')) {
      document.body.classList.remove('modal-open');
    }
    if (this.activeElementBeforeOpen) {
      this.activeElementBeforeOpen.focus();
    }
  }
};

// Global Component Loader
window.OrchidComponentLoader = {
  async init() {
    await this.mountSidebar();
    await this.mountHeader();
    await this.mountToast();
    await this.mountModal();
    this.highlightActiveNav();
    await this.initDropdowns();
    this.initHeaderTooltips();
    this.initWeatherDropdown();
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) window.location.reload();
    });
    const authenticated = await this.ensureAuthentication();
    if (!authenticated) return;
    this.initClockAndSync();
    this.startAuthenticationMonitor();
    this.initSensorNotifications();
    this.initDoubleSubmitProtection();
    try {
      if (window.sessionStorage.getItem('orchid-page-refreshed') === 'true') {
        window.sessionStorage.removeItem('orchid-page-refreshed');
        window.OrchidToast.show({
          variant: 'success',
          title: 'Page refreshed',
          message: 'The website has been refreshed.'
        });
      }
    } catch (error) {
      console.error('Could not restore the page-refresh notification.', error);
    }
    document.dispatchEvent(new CustomEvent('orchid:components-ready'));
  },

  async ensureAuthentication() {
    const gate = document.getElementById('account-auth-gate');
    const loginForm = document.getElementById('auth-login-form');
    const setupForm = document.getElementById('auth-setup-form');
    const recovery = document.getElementById('auth-password-recovery');
    const resetRequestForm = document.getElementById('auth-reset-request-form');
    const resetOtpForm = document.getElementById('auth-reset-otp-form');
    const resetConfirmForm = document.getElementById('auth-reset-confirm-form');
    const forgotPasswordButton = document.getElementById('auth-forgot-password');
    const resetBackButton = document.getElementById('auth-reset-back');
    const resendCodeButton = document.getElementById('auth-resend-code');
    const status = document.getElementById('account-auth-status');
    const retry = document.getElementById('auth-retry');
    const description = document.getElementById('account-auth-description');
    const title = document.getElementById('account-auth-title');
    if (!gate && !document.getElementById('header-mount')) return true;
    if (!gate || !loginForm || !setupForm || !recovery || !resetRequestForm ||
        !resetOtpForm || !resetConfirmForm || !forgotPasswordButton || !resetBackButton ||
        !resendCodeButton || !status || !retry) {
      throw new Error('The administrator access form could not be loaded.');
    }
    // Holds the verified OTP code between step 1 and step 2
    let verifiedResetCode = null;

    // ── OTP box helpers ─────────────────────────────────────────
    const otpDigits = () => Array.from(resetOtpForm.querySelectorAll('.otp-digit'));

    const getOtpValue = () => otpDigits().map((el) => el.value).join('');

    const clearOtpBoxes = () => {
      otpDigits().forEach((el) => {
        el.value = '';
        el.classList.remove('otp-digit--filled', 'otp-digit--error');
      });
    };

    const focusFirstOtpBox = () => {
      const first = resetOtpForm.querySelector('.otp-digit');
      if (first) first.focus();
    };

    const shakeOtpBoxes = () => {
      otpDigits().forEach((el) => {
        el.classList.add('otp-digit--error');
        el.addEventListener('animationend', () => el.classList.remove('otp-digit--error'), { once: true });
      });
    };

    const initOtpBoxes = () => {
      const digits = otpDigits();
      digits.forEach((box, index) => {
        // Only allow digits
        box.addEventListener('keydown', (event) => {
          if (event.key === 'Backspace') {
            event.preventDefault();
            if (box.value) {
              box.value = '';
              box.classList.remove('otp-digit--filled');
            } else if (index > 0) {
              const prev = digits[index - 1];
              prev.value = '';
              prev.classList.remove('otp-digit--filled');
              prev.focus();
            }
            return;
          }
          if (event.key === 'ArrowLeft' && index > 0) { digits[index - 1].focus(); return; }
          if (event.key === 'ArrowRight' && index < digits.length - 1) { digits[index + 1].focus(); return; }
          // Block non-digit, non-navigation keys
          if (!/^\d$/.test(event.key) && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
          }
        });

        box.addEventListener('input', () => {
          // Strip non-digits and keep only first char
          const digit = box.value.replace(/\D/g, '').slice(-1);
          box.value = digit;
          box.classList.toggle('otp-digit--filled', digit !== '');
          if (digit && index < digits.length - 1) {
            digits[index + 1].focus();
          }
        });

        // Select on focus so typing over an existing digit works cleanly
        box.addEventListener('focus', () => box.select());
      });

      // Paste: spread pasted digits across boxes
      digits[0].addEventListener('paste', (event) => {
        event.preventDefault();
        const pasted = (event.clipboardData || window.clipboardData)
          .getData('text').replace(/\D/g, '').slice(0, 6);
        pasted.split('').forEach((char, i) => {
          if (digits[i]) {
            digits[i].value = char;
            digits[i].classList.add('otp-digit--filled');
          }
        });
        const next = digits[Math.min(pasted.length, digits.length - 1)];
        if (next) next.focus();
      });
    };

    initOtpBoxes();

    // ── Password strength rules ──────────────────────────────────
    const PW_RULES = [
      { key: 'length',  label: 'At least 8 characters',              test: (v) => v.length >= 8 },
      { key: 'upper',   label: 'At least 1 uppercase letter',        test: (v) => /[A-Z]/.test(v) },
      { key: 'number',  label: 'At least 1 number',                  test: (v) => /[0-9]/.test(v) },
      { key: 'special', label: 'At least 1 special character',       test: (v) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(v) },
    ];

    const validatePassword = (value) => PW_RULES.every((rule) => rule.test(value));

    const initPasswordRules = (inputId) => {
      const input = document.getElementById(inputId);
      const list = gate.querySelector(`.pw-rules[data-for="${inputId}"]`);
      if (!input || !list) return;
      input.addEventListener('input', () => {
        const value = input.value;
        PW_RULES.forEach((rule) => {
          const li = list.querySelector(`[data-rule="${rule.key}"]`);
          if (li) li.classList.toggle('pw-rule--met', rule.test(value));
        });
      });
    };

    initPasswordRules('auth-setup-password');
    initPasswordRules('auth-reset-password');

    const updateAccountName = (name, email) => {
      document.querySelectorAll('.user-name').forEach((el) => { el.textContent = name; });
      document.querySelectorAll('.user-role').forEach((el) => { el.textContent = email; });
      const avatar = document.getElementById('btn-user-avatar');
      if (avatar) {
        avatar.setAttribute('aria-label', `User Profile: ${name}`);
        avatar.setAttribute('data-tip', email || name);
      }
    };
    const showGate = (accountExists, accountEmail, demoMode = false) => {
      gate.hidden = false;
      title.textContent = accountExists ? 'Sign in to ORCHID' : 'Set up administrator access';
      description.textContent = demoMode
        ? 'Enter the administrator password to continue.'
        : accountExists
        ? 'Enter the shared administrator password to continue.'
        : 'Create a shared administrator password for this local installation.';
      document.getElementById('auth-login-email').value = accountEmail || 'admin@orchid.local';
      loginForm.hidden = !accountExists;
      setupForm.hidden = accountExists;
      recovery.hidden = true;
      forgotPasswordButton.hidden = !accountExists || demoMode;
      status.textContent = '';
      retry.hidden = true;
    };
    const request = async (path, body = {}) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
      return result;
    };
    const restoreGate = async () => {
      status.textContent = 'Checking administrator access…';
      retry.hidden = true;
      try {
        const response = await fetch('/api/auth/status');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not check administrator access.');
        this.mockMode = Boolean(result.mock_mode);
        if (result.authenticated) {
          updateAccountName(result.account.display_name, result.account.email);
          gate.hidden = true;
          return true;
        }
        showGate(result.account_exists, result.account_email, result.mock_mode);
      } catch (error) {
        console.error('Could not check ORCHID administrator access.', error);
        gate.hidden = false;
        status.textContent = error.message;
        retry.hidden = false;
      }
      return false;
    };

    retry.addEventListener('click', async () => {
      if (await restoreGate()) window.location.reload();
    });
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = loginForm.querySelector('button[type="submit"]');
      const originalLabel = submit.textContent;
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      status.textContent = '';
      try {
        await request('/api/auth/login', {
          password: document.getElementById('auth-login-password').value
        });
        if (await restoreGate()) {
          this.initClockAndSync();
          this.startAuthenticationMonitor();
          this.initSensorNotifications();
          this.initDoubleSubmitProtection();
          document.dispatchEvent(new CustomEvent('orchid:components-ready'));
          window.OrchidToast.show({
            variant: 'success',
            title: 'Signed in',
            message: 'Your administrator session is ready.'
          });
        }
      } catch (error) {
        status.textContent = '';
        window.OrchidToast.show({
          variant: 'error',
          title: 'Sign in failed',
          message: error.message
        });
      } finally {
        if (!gate.hidden) {
          submit.disabled = false;
          submit.textContent = originalLabel;
        }
      }
    });
    forgotPasswordButton.addEventListener('click', () => {
      loginForm.hidden = true;
      recovery.hidden = false;
      resetRequestForm.hidden = false;
      resetOtpForm.hidden = true;
      resetConfirmForm.hidden = true;
      verifiedResetCode = null;
      status.textContent = '';
    });
    resetBackButton.addEventListener('click', () => {
      recovery.hidden = true;
      loginForm.hidden = false;
      verifiedResetCode = null;
      status.textContent = '';
    });

    // Helper: sends the recovery-code request and transitions to the OTP step
    const sendRecoveryCode = async (triggerButton) => {
      const originalLabel = triggerButton.textContent;
      triggerButton.disabled = true;
      triggerButton.textContent = 'Sending…';
      try {
        const result = await request('/api/auth/password-reset/request');
        resetRequestForm.hidden = true;
        resetOtpForm.hidden = false;
        resetConfirmForm.hidden = true;
        verifiedResetCode = null;
        clearOtpBoxes();
        status.textContent = '';
        window.OrchidToast.show({
          variant: 'info',
          title: 'Recovery code sent',
          message: result.message
        });
        focusFirstOtpBox();
      } catch (error) {
        window.OrchidToast.show({
          variant: 'error',
          title: 'Could not send recovery code',
          message: error.message
        });
      } finally {
        triggerButton.disabled = false;
        triggerButton.textContent = originalLabel;
      }
    };

    resetRequestForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await sendRecoveryCode(resetRequestForm.querySelector('button[type="submit"]'));
    });

    resendCodeButton.addEventListener('click', async () => {
      await sendRecoveryCode(resendCodeButton);
    });

    // Step 1 — verify OTP format client-side, then advance to step 2
    resetOtpForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = getOtpValue();
      if (!/^\d{6}$/.test(code)) {
        shakeOtpBoxes();
        window.OrchidToast.show({
          variant: 'warning',
          title: 'Invalid code',
          message: 'Enter the six-digit code exactly as it appears in the email.'
        });
        return;
      }
      // Store the code and advance to step 2
      verifiedResetCode = code;
      resetOtpForm.hidden = true;
      resetConfirmForm.hidden = false;
      document.getElementById('auth-reset-password').focus();
    });

    // Step 2 — submit new password (sends both the stored code + new password)
    resetConfirmForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = resetConfirmForm.querySelector('button[type="submit"]');
      const newPassword = document.getElementById('auth-reset-password').value;
      const confirmation = document.getElementById('auth-reset-password-confirm').value;
      if (!validatePassword(newPassword)) {
        window.OrchidToast.show({
          variant: 'warning',
          title: 'Password too weak',
          message: 'Your password must be at least 8 characters and include an uppercase letter, a number, and a special character.'
        });
        return;
      }
      if (newPassword !== confirmation) {
        window.OrchidToast.show({
          variant: 'warning',
          title: 'Passwords do not match',
          message: 'Enter the same new password in both fields.'
        });
        return;
      }
      if (!verifiedResetCode) {
        // Should not happen, but guard anyway
        window.OrchidToast.show({
          variant: 'error',
          title: 'Session expired',
          message: 'Go back and re-enter your recovery code.'
        });
        return;
      }
      const originalLabel = submit.textContent;
      submit.disabled = true;
      submit.textContent = 'Resetting…';
      try {
        await request('/api/auth/password-reset/confirm', {
          code: verifiedResetCode,
          new_password: newPassword
        });
        resetConfirmForm.reset();
        verifiedResetCode = null;
        recovery.hidden = true;
        loginForm.hidden = false;
        document.getElementById('auth-login-password').value = '';
        description.textContent = 'Your password was reset. Sign in with your new administrator password.';
        status.textContent = '';
        window.OrchidToast.show({
          variant: 'success',
          title: 'Password reset',
          message: 'Your password was reset. Sign in with your new password.'
        });
      } catch (error) {
        // If the code was wrong/expired the server says so — drop back to OTP step
        verifiedResetCode = null;
        resetConfirmForm.hidden = true;
        resetOtpForm.hidden = false;
        clearOtpBoxes();
        focusFirstOtpBox();
        window.OrchidToast.show({
          variant: 'error',
          title: 'Could not reset password',
          message: error.message
        });
      } finally {
        submit.disabled = false;
        submit.textContent = originalLabel;
      }
    });
    setupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = setupForm.querySelector('button[type="submit"]');
      const password = document.getElementById('auth-setup-password').value;
      if (!validatePassword(password)) {
        window.OrchidToast.show({
          variant: 'warning',
          title: 'Password too weak',
          message: 'Your password must be at least 8 characters and include an uppercase letter, a number, and a special character.'
        });
        return;
      }
      const originalLabel = submit.textContent;
      submit.disabled = true;
      submit.textContent = 'Saving…';
      status.textContent = '';
      try {
        await request('/api/auth/setup', {
          display_name: document.getElementById('auth-setup-name').value,
          email: document.getElementById('auth-setup-email').value,
          password: document.getElementById('auth-setup-password').value
        });
        loginForm.hidden = false;
        setupForm.hidden = true;
        title.textContent = 'Administrator password saved';
        description.textContent = 'Sign in with the password you just created.';
        document.getElementById('auth-login-password').value = document.getElementById('auth-setup-password').value;
        document.getElementById('auth-setup-password').value = '';
        status.textContent = '';
        window.OrchidToast.show({
          variant: 'success',
          title: 'Password saved',
          message: 'Your administrator password is ready. Sign in to continue.'
        });
      } catch (error) {
        status.textContent = '';
        window.OrchidToast.show({
          variant: 'error',
          title: 'Password setup failed',
          message: error.message
        });
      } finally {
        if (!setupForm.hidden) {
          submit.disabled = false;
          submit.textContent = originalLabel;
        }
      }
    });
    gate.querySelectorAll('.password-visibility-toggle').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const password = toggle.parentElement.querySelector('input[type="password"], input[type="text"]');
        const showPassword = password.type === 'password';
        password.type = showPassword ? 'text' : 'password';
        toggle.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
        toggle.title = showPassword ? 'Hide password' : 'Show password';
        toggle.querySelector('.password-visibility-slash').hidden = showPassword;
      });
    });
    return restoreGate();
  },

  startAuthenticationMonitor() {
    if (this.authMonitorStarted) return;
    this.authMonitorStarted = true;
    window.setInterval(async () => {
      try {
        const response = await fetch('/api/auth/status');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not verify the current session.');
        if (!result.authenticated) window.location.reload();
      } catch (error) {
        console.error('Could not refresh ORCHID session status.', error);
      }
    }, 60 * 1000);
  },

  getComponentPath(filename) {
    // Determine path relative to current HTML location
    const path = window.location.pathname;
    if (path.includes('/html/')) {
      return `../components/${filename}`;
    }
    return `components/${filename}`;
  },

  async loadHtml(filename) {
    const response = await fetch(this.getComponentPath(filename), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load ${filename}: HTTP ${response.status}`);
    }
    return response.text();
  },

  estimateBatteryPercent(batteryReading) {
    const millivolts = Number.parseFloat(String(batteryReading ?? '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(millivolts) || millivolts < 2500 || millivolts > 4500) return null;

    const curve = [
      [3000, 0], [3300, 5], [3500, 10], [3600, 20], [3700, 30],
      [3750, 40], [3800, 50], [3850, 60], [3900, 70], [4000, 80],
      [4100, 90], [4200, 100]
    ];
    if (millivolts <= curve[0][0]) return 0;
    if (millivolts >= curve[curve.length - 1][0]) return 100;

    for (let index = 1; index < curve.length; index += 1) {
      const [upperVoltage, upperPercent] = curve[index];
      const [lowerVoltage, lowerPercent] = curve[index - 1];
      if (millivolts <= upperVoltage) {
        const progress = (millivolts - lowerVoltage) / (upperVoltage - lowerVoltage);
        return Math.round(lowerPercent + progress * (upperPercent - lowerPercent));
      }
    }
    return null;
  },

  initSensorNotifications() {
    const trigger = document.getElementById('btn-notifications');
    const count = document.getElementById('sensor-alert-count');
    const panel = document.getElementById('sensor-alert-panel');
    const list = document.getElementById('sensor-alert-list');
    const summary = document.getElementById('sensor-alert-summary');
    const refreshButton = document.getElementById('btn-alert-refresh');
    if (!trigger || !count || !panel || !list || !summary || !refreshButton) return;

    let requestVersion = 0;

    const parseReading = (value) => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value !== 'string') return null;
      const match = value.match(/-?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    };

    const getHeatIndex = (node) => {
      const reported = parseReading(node.heatIndex);
      if (reported !== null) return reported;
      const temperature = parseReading(node.temperature);
      const humidity = parseReading(node.humidity);
      if (temperature === null || humidity === null ||
          temperature * 9 / 5 + 32 < 80 || humidity < 40) return temperature;
      const fahrenheit = temperature * 9 / 5 + 32;
      const heatIndex = -42.379 + 2.04901523 * fahrenheit + 10.14333127 * humidity
        - 0.22475541 * fahrenheit * humidity - 0.00683783 * fahrenheit ** 2
        - 0.05481717 * humidity ** 2 + 0.00122874 * fahrenheit ** 2 * humidity
        + 0.00085282 * fahrenheit * humidity ** 2 - 0.00000199 * fahrenheit ** 2 * humidity ** 2;
      return (heatIndex - 32) * 5 / 9;
    };

    const setEmptyState = (message, isError = false) => {
      list.replaceChildren();
      const item = document.createElement('li');
      item.className = `notification-empty${isError ? ' notification-empty--error' : ''}`;
      item.textContent = message;
      list.appendChild(item);
    };

    const renderAlerts = (alerts) => {
      count.hidden = alerts.length === 0;
      count.classList.remove('notification-count--error');
      count.textContent = alerts.length > 99 ? '99+' : String(alerts.length);
      trigger.classList.toggle('has-alerts', alerts.length > 0);
      trigger.setAttribute('aria-label', alerts.length
        ? `Sensor alerts, ${alerts.length} active`
        : 'Sensor alerts, none active');
      trigger.title = alerts.length ? `${alerts.length} active sensor alert${alerts.length === 1 ? '' : 's'}` : 'No active sensor alerts';
      summary.textContent = alerts.length
        ? `${alerts.length} active alert${alerts.length === 1 ? '' : 's'} across monitored sensors`
        : 'No active sensor alerts';
      if (!alerts.length) {
        setEmptyState('All monitored sensors are within alert limits.');
        return;
      }

      list.replaceChildren();
      const groups = [
        { key: 'battery', heading: 'Low battery' },
        { key: 'heat', heading: 'High heat index' },
        { key: 'offline', heading: 'Offline sensors' }
      ];
      groups.forEach((group) => {
        const groupAlerts = alerts.filter((alert) => alert.category === group.key);
        if (!groupAlerts.length) return;

        const groupItem = document.createElement('li');
        groupItem.className = 'notification-group';
        groupItem.dataset.category = group.key;
        const heading = document.createElement('h3');
        heading.className = 'notification-group-heading';
        heading.textContent = group.heading;
        const groupCount = document.createElement('span');
        groupCount.textContent = String(groupAlerts.length);
        heading.appendChild(groupCount);

        const groupList = document.createElement('ul');
        groupList.className = 'notification-group-list';
        groupAlerts.forEach((alert) => {
          const item = document.createElement('li');
          item.className = `notification-item notification-item--${alert.severity}`;
          const link = document.createElement('a');
          link.className = 'notification-item-link';
          link.href = `sensor.html?view=overview&node=${encodeURIComponent(alert.nodeId)}`;
          const title = document.createElement('strong');
          title.className = 'notification-item-title';
          title.textContent = alert.title;
          const message = document.createElement('span');
          message.className = 'notification-item-message';
          message.textContent = alert.message;
          link.append(title, message);
          item.appendChild(link);
          groupList.appendChild(item);
        });
        groupItem.append(heading, groupList);
        list.appendChild(groupItem);
      });
    };

    const buildAlerts = (nodes) => {
      const alerts = [];
      nodes.forEach((node) => {
        const nodeId = typeof node.id === 'string' || typeof node.id === 'number'
          ? String(node.id)
          : node.key;
        if (typeof nodeId !== 'string' || !nodeId) return;
        const location = typeof node.location === 'string' && node.location
          ? node.location
          : typeof node.name === 'string' && node.name
            ? node.name
            : `Node ${nodeId}`;
        const label = `${nodeId} · ${location}`;
        const status = typeof node.status === 'string' ? node.status.toLowerCase() : '';

        if (!['online', 'active', 'transmitting'].includes(status)) {
          alerts.push({
            category: 'offline',
            nodeId,
            severity: 'warning',
            title: 'Sensor offline',
            message: `${label} is not reporting.`
          });
        }

        const batteryPercent = this.estimateBatteryPercent(node.battery);
        const batteryWarning = batteryPercent !== null && batteryPercent < 20 ||
          String(node.sensorStatus) === '3';
        if (batteryWarning) {
          const battery = parseReading(node.battery);
          alerts.push({
            category: 'battery',
            nodeId,
            severity: batteryPercent !== null && batteryPercent < 10 ? 'critical' : 'warning',
            title: 'Low sensor battery',
            message: batteryPercent === null
              ? `${label} reports a battery warning.`
              : `${label} battery is approximately ${batteryPercent}%${battery === null ? '' : ` (${(battery / 1000).toFixed(2)} V)`}.`
          });
        }

        const heatIndex = getHeatIndex(node);
        if (heatIndex !== null && heatIndex >= 32) {
          alerts.push({
            category: 'heat',
            nodeId,
            severity: heatIndex >= 41 ? 'critical' : 'warning',
            title: heatIndex >= 41 ? 'Dangerous heat index' : 'High heat index',
            message: `${label} heat index is ${heatIndex.toFixed(1)}°C.`
          });
        }
      });
      return alerts;
    };

    const updateFromNodes = (nodes) => {
      const alerts = buildAlerts(nodes);
      renderAlerts(alerts);
    };

    const loadAlerts = async (nodes = null) => {
      const version = ++requestVersion;
      if (Array.isArray(nodes)) {
        updateFromNodes(nodes);
        return;
      }
      summary.textContent = 'Checking latest sensor readings…';
      try {
        const response = await fetch('/api/nodes', {
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        });
        const payload = await response.json().catch(() => {
          throw new Error(`The sensor API returned invalid JSON (${response.status}).`);
        });
        if (!response.ok) throw new Error(payload?.error || `Could not load sensor readings (${response.status}).`);
        if (!Array.isArray(payload.nodes) || payload.nodes.some((node) =>
          !node || typeof node !== 'object' || typeof node.status !== 'string')) {
          throw new Error('The sensor API returned an invalid node list.');
        }
        if (version !== requestVersion) return;
        updateFromNodes(payload.nodes);
      } catch (error) {
        if (version !== requestVersion) return;
        console.error('Could not load sensor alerts.', error);
        count.hidden = false;
        count.textContent = '!';
        count.classList.add('notification-count--error');
        trigger.setAttribute('aria-label', 'Sensor alert status unavailable');
        trigger.title = 'Sensor alert status unavailable';
        summary.textContent = 'Could not load the latest sensor readings.';
        setEmptyState(error.message, true);
      }
    };

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
      panel.hidden = isExpanded;
      trigger.setAttribute('aria-expanded', String(!isExpanded));
      if (!isExpanded) refreshButton.focus({ preventScroll: true });
    });
    refreshButton.addEventListener('click', async () => {
      refreshButton.disabled = true;
      try {
        await loadAlerts();
        window.OrchidToast.show({
          variant: 'success',
          title: 'Alerts refreshed',
          message: 'Sensor alert status is up to date.'
        });
      } finally {
        refreshButton.disabled = false;
      }
    });
    panel.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus({ preventScroll: true });
      }
    });
    window.addEventListener('orchid:sensor-data-updated', (event) => {
      const nodes = Array.isArray(event.detail) ? event.detail : event.detail?.nodes;
      if (!Array.isArray(nodes) || nodes.some((node) => !node || typeof node.status !== 'string')) {
        console.error('Invalid orchid:sensor-data-updated event received by sensor alerts.');
        return;
      }
      loadAlerts(nodes);
      // Update sidebar data status text
      const statusEl = document.getElementById('sidebar-data-status');
      if (statusEl) {
        const onlineCount = nodes.filter((n) => n.status === 'Online').length;
        const total = nodes.length;
        if (total === 0) {
          statusEl.textContent = 'No sensor nodes registered';
        } else if (onlineCount === 0) {
          statusEl.textContent = `${total} node${total !== 1 ? 's' : ''} — all offline`;
        } else {
          statusEl.textContent = `${onlineCount} of ${total} node${total !== 1 ? 's' : ''} online`;
        }
      }
    });
    window.addEventListener('orchid:data-refresh', () => loadAlerts());
    loadAlerts();
  },

  async initDropdowns() {
    const selects = document.querySelectorAll('select[data-dropdown]');
    if (!selects.length) return;

    const templateHtml = await this.loadHtml('dropdown.html');
    const templateDocument = new DOMParser().parseFromString(templateHtml, 'text/html');
    const template = templateDocument.getElementById('orchid-dropdown-template');
    if (!template) {
      throw new Error('The shared dropdown template is missing.');
    }

    selects.forEach((select) => {
      const dropdown = template.content.firstElementChild.cloneNode(true);
      const trigger = dropdown.querySelector('.orchid-dropdown-trigger');
      const value = dropdown.querySelector('.orchid-dropdown-value');
      const menu = dropdown.querySelector('.orchid-dropdown-menu');
      const options = Array.from(select.options);
      const enabledOptions = [];

      if (!trigger || !value || !menu) {
        throw new Error('The shared dropdown template is incomplete.');
      }

      if (select.dataset.dropdownClass) {
        dropdown.classList.add(...select.dataset.dropdownClass.split(/\s+/).filter(Boolean));
      }
      trigger.id = `${select.id}-trigger`;
      menu.id = `${select.id}-options`;
      trigger.setAttribute('aria-controls', menu.id);
      trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Select an option');
      trigger.disabled = select.disabled;
      if (select.dataset.tip) trigger.dataset.tip = select.dataset.tip;
      select.setAttribute('aria-hidden', 'true');
      select.tabIndex = -1;
      select.classList.add('orchid-dropdown-native');
      select.insertAdjacentElement('afterend', dropdown);

      const optionElements = options.map((option) => {
        // Placeholder options (value="") display in the trigger but are hidden from the menu
        if (option.value === '') return null;
        const item = document.createElement('div');
        item.className = 'orchid-dropdown-option';
        item.setAttribute('role', 'option');
        item.dataset.value = option.value;
        item.textContent = option.textContent.trim();
        item.tabIndex = -1;
        item.setAttribute('aria-selected', String(option.selected));
        if (option.disabled) {
          item.setAttribute('aria-disabled', 'true');
        } else {
          enabledOptions.push(item);
        }
        item.addEventListener('click', () => {
          if (option.disabled) return;
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          closeMenu(true);
        });
        menu.appendChild(item);
        return item;
      });

      const syncSelection = () => {
        const selectedOption = select.options[select.selectedIndex];
        if (!selectedOption) return;
        value.textContent = selectedOption.textContent.trim();
        optionElements.forEach((item) => {
          if (!item) return;
          const selected = item.dataset.value === select.value;
          item.setAttribute('aria-selected', String(selected));
        });
      };

      const focusOption = (index) => {
        if (!enabledOptions.length) return;
        const nextIndex = (index + enabledOptions.length) % enabledOptions.length;
        enabledOptions[nextIndex].focus();
      };

      const closeMenu = (returnFocus = false) => {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (returnFocus) trigger.focus();
      };

      const openMenu = (direction = 0) => {
        // Append to body so no overflow:hidden ancestor can clip the menu
        if (menu.parentElement !== document.body) {
          document.body.appendChild(menu);
        }
        const rect = trigger.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom + 6}px`;
        menu.style.left = `${rect.left}px`;
        menu.style.width = `${rect.width}px`;
        menu.style.right = 'auto';
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        const selectedIndex = enabledOptions.findIndex((item) => item.dataset.value === select.value);
        focusOption((selectedIndex >= 0 ? selectedIndex : 0) + direction);
        const tooltip = document.getElementById('orchid-header-tooltip');
        if (tooltip) tooltip.style.opacity = '0';
        trigger.removeAttribute('aria-describedby');
      };

      trigger.addEventListener('click', () => {
        if (menu.hidden) openMenu();
        else closeMenu();
      });

      trigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          openMenu(event.key === 'ArrowDown' ? 0 : -1);
        } else if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          if (menu.hidden) openMenu();
          else closeMenu();
        }
      });

      menu.addEventListener('keydown', (event) => {
        const currentIndex = enabledOptions.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          focusOption(currentIndex + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          focusOption(event.key === 'Home' ? 0 : enabledOptions.length - 1);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          document.activeElement.click();
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          closeMenu(event.key === 'Escape');
        }
      });

      document.addEventListener('click', (event) => {
        if (!dropdown.contains(event.target)) closeMenu();
      });
      select.addEventListener('change', syncSelection);
      syncSelection();

      // Expose a sync method so dynamic callers can rebuild the menu after replaceChildren()
      select._orchidDropdownSync = () => {
        const newOptions = Array.from(select.options);
        menu.replaceChildren();
        enabledOptions.length = 0;
        newOptions.forEach((option) => {
          // Placeholder options (value="") display in the trigger but are hidden from the menu
          if (option.value === '') return;
          const item = document.createElement('div');
          item.className = 'orchid-dropdown-option';
          item.setAttribute('role', 'option');
          item.dataset.value = option.value;
          item.textContent = option.textContent.trim();
          item.tabIndex = -1;
          item.setAttribute('aria-selected', String(option.selected));
          if (option.disabled) {
            item.setAttribute('aria-disabled', 'true');
          } else {
            enabledOptions.push(item);
          }
          item.addEventListener('click', () => {
            if (option.disabled) return;
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            closeMenu(true);
          });
          menu.appendChild(item);
        });
        trigger.disabled = select.disabled;
        syncSelection();
      };
    });
  },

  /**
   * initNodeSearch — mounts the reusable node search combobox component.
   *
   * Usage (call after orchid:components-ready):
   *   await OrchidComponentLoader.initNodeSearch(mountEl, items, onSelect);
   *
   * @param {Element}  mountEl   — the container element to replace with the component
   * @param {Array}    items     — array of { key, label, sublabel, status, unplaced }
   * @param {Function} onSelect  — callback(item) fired when the user commits a selection
   */
  /**
   * initAnalyticsTooltips — wires up the rich hover/focus tooltip for any
   * .analytics-interactive-card[data-tip-title] elements on the page.
   *
   * Usage: OrchidComponentLoader.initAnalyticsTooltips();
   * Scoped: OrchidComponentLoader.initAnalyticsTooltips('.my-section .analytics-interactive-card');
   *
   * @param {string} [selector] — optional CSS selector to narrow which cards get tooltips.
   *                              Defaults to all .analytics-interactive-card[data-tip-title] on the page.
   */
  /**
   * Mounts the reusable single-control date-range filter.
   * Calls onChange(startDate, endDate) on mount and whenever either date changes.
   */
  async initDateRangeFilter(mountEl, options = {}) {
    if (!mountEl) return null;

    const templateHtml = await this.loadHtml('date-filter.html');
    const doc = new DOMParser().parseFromString(templateHtml, 'text/html');
    const template = doc.getElementById('orchid-date-filter-template');
    if (!template) throw new Error('orchid-date-filter-template not found in date-filter.html');

    const root = template.content.firstElementChild.cloneNode(true);
    const resetButton = root.querySelector('.odf-reset');
    const dateField = root.querySelector('.odf-date-field');
    const trigger = root.querySelector('.odf-date-trigger');
    const dateLabel = root.querySelector('.odf-date-label');
    const calendar = root.querySelector('.odf-calendar');
    const monthLabel = root.querySelector('.odf-calendar-month');
    const instruction = root.querySelector('.odf-calendar-instruction');
    const daysGrid = root.querySelector('.odf-calendar-days');
    const previousButton = root.querySelector('.odf-calendar-previous');
    const nextButton = root.querySelector('.odf-calendar-next');
    const todayButton = root.querySelector('.odf-calendar-today');
    const rangeLimitLabel = root.querySelector('.odf-calendar-footer span');
    if (!resetButton || !dateField || !trigger || !dateLabel || !calendar || !monthLabel ||
        !instruction || !daysGrid || !previousButton || !nextButton || !todayButton || !rangeLimitLabel) {
      throw new Error('Date filter controls are missing from date-filter.html');
    }

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    const maxRangeDays = Number.isInteger(options.maxRangeDays) && options.maxRangeDays > 0
      ? options.maxRangeDays
      : 30;
    rangeLimitLabel.textContent = `Up to ${maxRangeDays} days`;
    const parseDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
      const [, year, month, day] = match.map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
        ? date
        : null;
    };
    const dateKey = (date) => [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0')
    ].join('-');
    const validDate = (value) => {
      const date = parseDate(value);
      return date !== null && value <= today;
    };
    const addDays = (value, count) => {
      const date = parseDate(value);
      date.setUTCDate(date.getUTCDate() + count);
      return dateKey(date);
    };
    let startDate = validDate(options.initialStartDate)
      ? options.initialStartDate
      : validDate(options.initialDate) ? options.initialDate : today;
    let endDate = validDate(options.initialEndDate)
      ? options.initialEndDate
      : validDate(options.initialDate) ? options.initialDate : today;
    if (startDate > endDate) startDate = endDate;
    if (!options.allowLongInitialRange && addDays(startDate, maxRangeDays - 1) < endDate) {
      startDate = addDays(endDate, -(maxRangeDays - 1));
    }
    let draftStartDate = null;
    let displayedDate = parseDate(startDate);

    mountEl.replaceWith(root);

    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    });
    const formatRange = (start, end) => dateFormatter.formatRange(
      parseDate(start),
      parseDate(end)
    );
    const updateLabel = () => {
      dateLabel.textContent = formatRange(startDate, endDate);
      trigger.setAttribute('aria-label', `Choose date range, ${formatRange(startDate, endDate)}`);
    };
    const updateInstruction = () => {
      instruction.textContent = draftStartDate
        ? `Start: ${dateFormatter.format(parseDate(draftStartDate))}. Select an end date.`
        : 'Select a start date';
    };
    const closeCalendar = (restoreFocus = false, cancelDraft = true) => {
      calendar.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (cancelDraft) draftStartDate = null;
      updateInstruction();
      renderCalendar();
      if (restoreFocus) trigger.focus({ preventScroll: true });
    };
    const renderCalendar = () => {
      const monthDate = new Date(Date.UTC(displayedDate.getUTCFullYear(), displayedDate.getUTCMonth(), 1));
      monthLabel.textContent = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(monthDate);
      const previousMonthEnd = dateKey(new Date(Date.UTC(
        displayedDate.getUTCFullYear(), displayedDate.getUTCMonth(), 0
      )));
      const nextMonthStart = dateKey(new Date(Date.UTC(
        displayedDate.getUTCFullYear(), displayedDate.getUTCMonth() + 1, 1
      )));
      const minDate = draftStartDate ? addDays(draftStartDate, -(maxRangeDays - 1)) : '0001-01-01';
      const maxDate = draftStartDate ? addDays(draftStartDate, maxRangeDays - 1) : today;
      previousButton.disabled = previousMonthEnd < minDate;
      nextButton.disabled = nextMonthStart > maxDate || nextMonthStart > today;
      daysGrid.replaceChildren();
      for (let index = 0; index < monthDate.getUTCDay(); index += 1) {
        const blank = document.createElement('span');
        blank.className = 'odf-calendar-empty';
        blank.setAttribute('aria-hidden', 'true');
        daysGrid.appendChild(blank);
      }
      const daysInMonth = new Date(Date.UTC(
        displayedDate.getUTCFullYear(), displayedDate.getUTCMonth() + 1, 0
      )).getUTCDate();
      for (let day = 1; day <= daysInMonth; day += 1) {
        const value = dateKey(new Date(Date.UTC(
          displayedDate.getUTCFullYear(), displayedDate.getUTCMonth(), day
        )));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'odf-calendar-day';
        button.dataset.date = value;
        button.textContent = String(day);
        button.setAttribute('aria-label', dateFormatter.format(parseDate(value)));
        button.setAttribute('aria-pressed', String(value === startDate || value === endDate));
        if (value === today) button.classList.add('is-today');
        if (draftStartDate && value === draftStartDate) button.classList.add('is-selected');
        else if (!draftStartDate && value === startDate) button.classList.add('is-selected');
        else if (!draftStartDate && value === endDate) button.classList.add('is-selected');
        if (draftStartDate && value === draftStartDate) button.classList.add('is-in-range');
        else if (!draftStartDate && value >= startDate && value <= endDate) {
          button.classList.add('is-in-range');
        }
        button.disabled = value > today ||
          (draftStartDate && (value < minDate || value > maxDate));
        daysGrid.appendChild(button);
      }
    };
    const focusSelectedDate = () => {
      const focusDate = draftStartDate || startDate;
      daysGrid.querySelector(`button[data-date="${focusDate}"]`)?.focus({ preventScroll: true });
    };

    updateLabel();
    updateInstruction();
    renderCalendar();
    trigger.addEventListener('click', () => {
      if (!calendar.hidden) {
        closeCalendar();
        return;
      }
      draftStartDate = null;
      displayedDate = parseDate(startDate);
      updateInstruction();
      renderCalendar();
      calendar.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      focusSelectedDate();
    });
    previousButton.addEventListener('click', () => {
      displayedDate = new Date(Date.UTC(displayedDate.getUTCFullYear(), displayedDate.getUTCMonth() - 1, 1));
      renderCalendar();
      focusSelectedDate();
    });
    nextButton.addEventListener('click', () => {
      displayedDate = new Date(Date.UTC(displayedDate.getUTCFullYear(), displayedDate.getUTCMonth() + 1, 1));
      renderCalendar();
      focusSelectedDate();
    });
    daysGrid.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-date]');
      if (!button || !daysGrid.contains(button) || button.disabled) return;
      const value = button.dataset.date;
      if (!draftStartDate || value < draftStartDate) {
        draftStartDate = value;
        displayedDate = parseDate(value);
        updateInstruction();
        renderCalendar();
        focusSelectedDate();
        return;
      }
      startDate = draftStartDate;
      endDate = value;
      draftStartDate = null;
      updateLabel();
      updateInstruction();
      closeCalendar(false, false);
      onChange(startDate, endDate);
      trigger.focus({ preventScroll: true });
    });
    daysGrid.addEventListener('keydown', (event) => {
      const button = event.target.closest('button[data-date]');
      if (!button) return;
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (!Object.hasOwn(offsets, event.key)) return;
      event.preventDefault();
      const value = addDays(button.dataset.date, offsets[event.key]);
      const maxDate = draftStartDate ? addDays(draftStartDate, maxRangeDays - 1) : today;
      if (value > today || (draftStartDate && value > maxDate)) return;
      displayedDate = parseDate(value);
      renderCalendar();
      daysGrid.querySelector(`button[data-date="${value}"]`)?.focus({ preventScroll: true });
    });
    todayButton.addEventListener('click', () => {
      startDate = today;
      endDate = today;
      draftStartDate = null;
      displayedDate = parseDate(today);
      updateLabel();
      closeCalendar(true, false);
      onChange(startDate, endDate);
    });
    calendar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCalendar(true);
      }
    });
    document.addEventListener('click', (event) => {
      if (root.isConnected && !event.composedPath().includes(root) && !calendar.hidden) closeCalendar();
    });
    resetButton.addEventListener('click', () => {
      startDate = today;
      endDate = today;
      draftStartDate = null;
      displayedDate = parseDate(today);
      updateLabel();
      updateInstruction();
      renderCalendar();
      onChange(startDate, endDate);
    });
    onChange(startDate, endDate);

    return {
      getStartDate: () => startDate,
      getEndDate: () => endDate,
      setRange: (start, end, allowLongRange = false) => {
        startDate = validDate(start) ? start : today;
        endDate = validDate(end) ? end : today;
        if (startDate > endDate) startDate = endDate;
        if (!allowLongRange && addDays(startDate, maxRangeDays - 1) < endDate) {
          startDate = addDays(endDate, -(maxRangeDays - 1));
        }
        draftStartDate = null;
        displayedDate = parseDate(startDate);
        updateLabel();
        updateInstruction();
        renderCalendar();
        onChange(startDate, endDate);
      }
    };
  },

  /**
   * initPagination — mounts the reusable pagination component into a container.
   *
   * Usage:
   *   const pg = await OrchidComponentLoader.initPagination(mountEl, {
   *     total: 100,
   *     pageSize: 10,
   *     page: 1,
   *     onChange: (page, pageSize) => { ... }
   *   });
   *
   * @param {Element} mountEl — container element to append pagination into
   * @param {object} options — { total, pageSize, page, onChange }
   * @returns {object} API — { setTotal, setPage, getPage, getPageSize }
   */
  async initPagination(mountEl, options = {}) {
    if (!mountEl) return null;

    const templateHtml = await this.loadHtml('pagination.html');
    const doc          = new DOMParser().parseFromString(templateHtml, 'text/html');
    const template     = doc.getElementById('orchid-pagination-template');
    if (!template) throw new Error('orchid-pagination-template not found in pagination.html');

    const root       = template.content.firstElementChild.cloneNode(true);
    const infoEl     = root.querySelector('.opg-info');
    const pagesEl    = root.querySelector('.opg-pages');
    const prevBtn    = root.querySelector('.opg-prev');
    const nextBtn    = root.querySelector('.opg-next');

    mountEl.appendChild(root);

    let total    = options.total    ?? 0;
    let pageSize = options.pageSize ?? 5;
    let page     = options.page     ?? 1;
    const onChange = options.onChange ?? (() => {});

    // Set default selected option to match pageSize — no select in this design

    function totalPages() {
      return Math.max(1, Math.ceil(total / pageSize));
    }

    function render() {
      const tp    = totalPages();
      const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
      const end   = Math.min(page * pageSize, total);

      // Info label — "Showing X to Y of Z entries"
      infoEl.textContent = total === 0
        ? 'No entries found'
        : `Showing ${start} to ${end} of ${total} entries`;

      // Prev / Next
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page >= tp;

      // Page buttons — show up to 7 slots with ellipsis
      pagesEl.replaceChildren();
      const pages = buildPageRange(page, tp);

      pages.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';

        if (p === '…') {
          btn.className   = 'opg-page opg-page--ellipsis';
          btn.textContent = '…';
          btn.setAttribute('aria-hidden', 'true');
        } else {
          btn.className   = `opg-page${p === page ? ' opg-page--active' : ''}`;
          btn.textContent = p;
          btn.setAttribute('aria-label', `Page ${p}`);
          btn.setAttribute('aria-current', p === page ? 'page' : 'false');
          if (p !== page) {
            btn.addEventListener('click', () => goTo(p));
          }
        }

        pagesEl.appendChild(btn);
      });
    }

    // Build a compact page range: always show first, last, current ±1, with ellipsis
    function buildPageRange(current, total) {
      if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

      const pages = new Set([1, total, current, current - 1, current + 1]);
      const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

      const result = [];
      let prev = null;
      sorted.forEach((p) => {
        if (prev !== null && p - prev > 1) result.push('…');
        result.push(p);
        prev = p;
      });
      return result;
    }

    function goTo(p) {
      const tp = totalPages();
      page = Math.max(1, Math.min(p, tp));
      render();
      onChange(page, pageSize);
    }

    prevBtn.addEventListener('click', () => goTo(page - 1));
    nextBtn.addEventListener('click', () => goTo(page + 1));

    render();

    // Public API
    return {
      setTotal(newTotal) {
        total = newTotal;
        page  = 1;
        render();
      },
      setPage(p) { goTo(p); },
      getPage()     { return page; },
      getPageSize() { return pageSize; }
    };
  },

  initAnalyticsTooltips(selector) {
    // Reuse an existing tip element if one was already created (e.g. called twice)
    let tip = document.getElementById('orchid-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'orchid-tooltip';
      document.body.appendChild(tip);
    }

    const query = selector || '.analytics-interactive-card[data-tip-title]';
    const cards = document.querySelectorAll(query);

    const hide = (card) => {
      if (card.matches(':hover, :focus')) return;
      tip.className = '';
      tip.replaceChildren();
      tip.style.opacity = '0';
      card.removeAttribute('aria-describedby');
    };

    const show = (card) => {
      tip.id        = 'orchid-tooltip';
      tip.className = 'analytics-tooltip';
      tip.replaceChildren();

      const title = document.createElement('div');
      title.className = 'analytics-tooltip-title';
      title.textContent = card.getAttribute('data-tip-title');
      tip.appendChild(title);

      const description = document.createElement('p');
      description.className = 'analytics-tooltip-description';
      description.textContent = card.getAttribute('data-tip-description');
      tip.appendChild(description);

      const points = card.getAttribute('data-tip-points');
      if (points) {
        const list = document.createElement('ul');
        list.className = 'analytics-tooltip-points';
        points.split('|').forEach((point) => {
          const item = document.createElement('li');
          item.textContent = point;
          list.appendChild(item);
        });
        tip.appendChild(list);
      }

      const reading = card.getAttribute('data-tip-reading');
      if (reading) {
        const readingEl = document.createElement('p');
        readingEl.className = 'analytics-tooltip-reading';
        readingEl.textContent = reading;
        tip.appendChild(readingEl);
      }

      card.setAttribute('aria-describedby', 'orchid-tooltip');

      // Render off-screen first so the browser lays it out, then measure and position
      tip.style.left    = '-9999px';
      tip.style.top     = '-9999px';
      tip.style.opacity = '0';

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const w    = tip.offsetWidth;
          const h    = tip.offsetHeight;
          const gap  = 10;

          const left = Math.max(8, Math.min(
            rect.left + rect.width / 2 - w / 2,
            window.innerWidth - w - 8
          ));

          // Always above; clamp so it never clips off the top edge
          const top = Math.max(8, rect.top - h - gap);

          tip.style.left    = `${left}px`;
          tip.style.top     = `${top}px`;
          tip.style.opacity = '1';
        });
      });
    };

    cards.forEach((card) => {
      card.addEventListener('mouseenter', () => show(card));
      card.addEventListener('mouseleave', () => hide(card));
      card.addEventListener('focus',      () => show(card));
      card.addEventListener('blur',       () => hide(card));
    });
  },

  async initNodeSearch(mountEl, items, onSelect) {
    if (!mountEl) return;

    // Load and clone the template
    const templateHtml = await this.loadHtml('node-search.html');
    const doc = new DOMParser().parseFromString(templateHtml, 'text/html');
    const template = doc.getElementById('orchid-node-search-template');
    if (!template) throw new Error('orchid-node-search-template not found in node-search.html');

    const root = template.content.firstElementChild.cloneNode(true);
    mountEl.replaceWith(root);

    const input      = root.querySelector('.ons-input');
    const clearBtn   = root.querySelector('.ons-clear-btn');
    const listbox    = root.querySelector('.ons-listbox');
    const inputWrap  = root.querySelector('.ons-input-wrap');

    // Give the listbox a unique id so aria-controls resolves correctly
    const uid = `ons-listbox-${Math.random().toString(36).slice(2, 8)}`;
    listbox.id = uid;
    input.setAttribute('aria-controls', uid);

    let selectedItem = items[0] || null;
    let activeIndex  = -1;
    let isOpen       = false;

    // ── Helpers ──────────────────────────────────────────────────────────

    function dotClass(item) {
      if (item.status === 'Online')  return 'ons-option-dot--online';
      if (item.unplaced)             return 'ons-option-dot--unplaced';
      return 'ons-option-dot--offline';
    }

    /** Wrap every occurrence of `query` in an .ons-match span inside `text` */
    function highlight(text, query) {
      if (!query) return document.createTextNode(text);
      const re  = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const frag = document.createDocumentFragment();
      text.split(re).forEach((part) => {
        if (re.test(part)) {
          const mark = document.createElement('span');
          mark.className = 'ons-match';
          mark.textContent = part;
          frag.appendChild(mark);
          re.lastIndex = 0;        // reset after test() consumed a match
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      });
      return frag;
    }

    // ── Show selected item as a text chip in the closed input ─────────────

    function showChip(item) {
      input.value = '';
      input.placeholder = item ? `${item.key.toUpperCase()}  ·  ${item.sublabel}` : 'Search nodes…';
    }

    // ── Open / close ──────────────────────────────────────────────────────

    function openList(query = '') {
      isOpen = true;
      activeIndex = -1;
      root.setAttribute('aria-expanded', 'true');
      input.placeholder = 'Search nodes…';
      renderList(query);
      listbox.hidden = false;
    }

    function closeList() {
      isOpen = false;
      root.setAttribute('aria-expanded', 'false');
      listbox.hidden = true;
      activeIndex = -1;
      showChip(selectedItem);
    }

    // ── Render filtered list ──────────────────────────────────────────────

    function renderList(query) {
      listbox.replaceChildren();
      const q = query.trim().toLowerCase();

      const matched = items.filter((item) =>
        !q ||
        item.key.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.sublabel.toLowerCase().includes(q)
      );

      if (!matched.length) {
        const empty = document.createElement('li');
        empty.className = 'ons-empty';
        empty.textContent = 'No nodes match your search.';
        listbox.appendChild(empty);
        return;
      }

      // Group into deployed vs unplaced
      const deployed  = matched.filter((i) => !i.unplaced);
      const unplaced  = matched.filter((i) =>  i.unplaced);
      const allOptions = [];

      const renderGroup = (groupItems, groupLabel) => {
        if (!groupItems.length) return;

        const lbl = document.createElement('li');
        lbl.className = 'ons-group-label';
        lbl.setAttribute('role', 'presentation');
        lbl.textContent = groupLabel;
        listbox.appendChild(lbl);

        groupItems.forEach((item) => {
          const li = document.createElement('li');
          li.className = 'ons-option';
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', String(selectedItem?.key === item.key));
          li.tabIndex = -1;
          li.dataset.key = item.key;

          const dot = document.createElement('span');
          dot.className = `ons-option-dot ${dotClass(item)}`;

          const body = document.createElement('span');
          body.className = 'ons-option-body';

          const idLine = document.createElement('span');
          idLine.className = 'ons-option-id';
          idLine.appendChild(highlight(item.key.toUpperCase(), q.toUpperCase()));

          const nameLine = document.createElement('span');
          nameLine.className = 'ons-option-name';
          nameLine.appendChild(highlight(item.sublabel, query.trim()));

          body.appendChild(idLine);
          body.appendChild(nameLine);
          li.appendChild(dot);
          li.appendChild(body);

          li.addEventListener('mousedown', (e) => {
            e.preventDefault();           // prevent input blur before click registers
            commitSelection(item);
          });

          listbox.appendChild(li);
          allOptions.push(li);
        });
      };

      renderGroup(deployed, 'Deployed Nodes');
      renderGroup(unplaced, 'Unplaced Sensors');

      // Store on root for keyboard nav
      root._onsOptions = allOptions;
    }

    // ── Commit a selection ────────────────────────────────────────────────

    function commitSelection(item) {
      selectedItem = item;
      closeList();
      if (typeof onSelect === 'function') onSelect(item);
    }

    // ── Keyboard navigation ───────────────────────────────────────────────

    function setActive(index) {
      const opts = root._onsOptions || [];
      if (!opts.length) return;
      activeIndex = Math.max(0, Math.min(index, opts.length - 1));
      opts.forEach((el, i) => {
        el.classList.toggle('ons-option--active', i === activeIndex);
        if (i === activeIndex) {
          el.setAttribute('aria-selected', 'true');
          el.scrollIntoView({ block: 'nearest' });
          input.setAttribute('aria-activedescendant', el.id || '');
        } else {
          el.setAttribute('aria-selected', el.dataset.key === selectedItem?.key ? 'true' : 'false');
        }
      });
    }

    // ── Event listeners ───────────────────────────────────────────────────

    input.addEventListener('focus', () => {
      openList(input.value);
    });

    input.addEventListener('input', () => {
      clearBtn.hidden = false;
      renderList(input.value);
      if (!isOpen) openList(input.value);
    });

    input.addEventListener('keydown', (e) => {
      const opts = root._onsOptions || [];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isOpen) { openList(input.value); return; }
        setActive(activeIndex < 0 ? 0 : activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(activeIndex <= 0 ? opts.length - 1 : activeIndex - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && opts[activeIndex]) {
          commitSelection(items.find((it) => it.key === opts[activeIndex].dataset.key));
        } else if (opts.length === 1) {
          commitSelection(items.find((it) => it.key === opts[0].dataset.key));
        }
      } else if (e.key === 'Escape') {
        closeList();
        input.blur();
      }
    });

    input.addEventListener('blur', () => {
      // Slight delay so mousedown on an option fires first
      setTimeout(() => { if (isOpen) closeList(); }, 120);
    });

    clearBtn.addEventListener('click', () => {
      if (isOpen) {
        closeList();
        input.blur();
      } else {
        input.value = '';
        input.focus();
        openList('');
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (isOpen && !root.contains(e.target)) closeList();
    });

    // ── Initial state ─────────────────────────────────────────────────────

    showChip(selectedItem);
    clearBtn.hidden = false;
    if (selectedItem && typeof onSelect === 'function') onSelect(selectedItem);
  },

  async mountSidebar() {    const slot = document.getElementById('sidebar-mount');
    if (!slot) return;
    const html = await this.loadHtml('sidebar.html');
    slot.outerHTML = html;
  },

  async mountHeader() {
    const slot = document.getElementById('header-mount');
    if (!slot) return;
    const html = await this.loadHtml('header.html');
    slot.innerHTML = html;
    const pathname = window.location.pathname.toLowerCase();
    const pageHeading = slot.querySelector('#page-heading');

    if (pathname.endsWith('/map.html') || pathname.includes('map')) {
      if (pageHeading) pageHeading.textContent = 'SENSOR MAP';
    }

    if (pathname.endsWith('/sensor.html') || pathname.includes('sensor')) {
      if (pageHeading) pageHeading.textContent = 'SENSOR MANAGEMENT';
    }

    if (pathname.endsWith('/heat-index.html') || pathname.includes('heat-index')) {
      const metric = new URLSearchParams(window.location.search).get('metric');
      const headings = {
        temperature: 'TEMPERATURE MONITORING',
        humidity: 'HUMIDITY MONITORING',
        pressure: 'PRESSURE MONITORING'
      };
      if (pageHeading) pageHeading.textContent = headings[metric] || 'HEAT INDEX MONITORING';
    }

    if (pathname.endsWith('/privacy.html') && pageHeading) {
      pageHeading.textContent = 'PRIVACY NOTICE';
    }

    if (pathname.endsWith('/management.html')) {
      const view = new URLSearchParams(window.location.search).get('view');
      const managementViews = {
        reports: {
          heading: 'REPORTS',
          title: 'Reports',
          description: 'Review sensor readings and trends for a selected metric and date range.'
        },
        audit: {
          heading: 'AUDIT TRAIL',
          title: 'Audit Trail',
          description: 'The audit trail is under construction. This section will be available when the ORCHID system is finalized.'
        },
        account: {
          heading: 'ACCOUNT & SECURITY',
          title: 'Account & Security',
          description: 'Manage the shared administrator profile and secure sign-in details.'
        }
      };
      const currentView = managementViews[view] || managementViews.reports;
      if (pageHeading) pageHeading.textContent = currentView.heading;
      const title = document.getElementById('management-title');
      if (title) title.textContent = currentView.title;
      const description = document.getElementById('management-description');
      if (description) description.textContent = currentView.description;
    }
  },

  async mountToast() {
    let slot = document.getElementById('toast-mount');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'toast-mount';
      document.body.appendChild(slot);
    }
    const html = await this.loadHtml('toast.html');
    slot.innerHTML = html;
  },

  async mountModal() {
    let slot = document.getElementById('modal-mount');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'modal-mount';
      document.body.appendChild(slot);
    }
    const html = await this.loadHtml('modal.html');
    slot.innerHTML = html;
    window.OrchidModal.init();
  },

  highlightActiveNav() {
    const currentPath = window.location.pathname.toLowerCase();
    const metric = new URLSearchParams(window.location.search).get('metric');
    const managementView = new URLSearchParams(window.location.search).get('view');
    const privacyLink = document.getElementById('cfg-privacy-link');
    if (privacyLink && currentPath.endsWith('/privacy.html')) {
      privacyLink.setAttribute('aria-current', 'page');
    }
    if (privacyLink && !currentPath.endsWith('/privacy.html')) {
      privacyLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.OrchidModal.open({
          title: 'Privacy Notice',
          wide: true,
          hideFooter: true,
          bodyHtml: `
            <div style="padding:4px 0 8px;">
              <p style="font-size:0.7rem;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:var(--text-secondary);margin:0 0 14px;">Effective: ${new Date().getFullYear()} · ORCHID Heat Index Monitoring System</p>

              <p style="color:var(--text-body);font-size:0.88rem;line-height:1.65;margin:0 0 16px;">
                ORCHID is a local environmental monitoring system operated by the City Government of Ormoc. This notice explains what data the system collects, how it is used, and how it is protected.
              </p>

              <p style="font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-accent-light);margin:0 0 6px;">What We Collect</p>
              <ul style="color:var(--text-body);font-size:0.87rem;line-height:1.7;margin:0 0 16px;padding-left:18px;">
                <li><strong style="color:var(--text-white);">Environmental readings</strong> — temperature, humidity, atmospheric pressure, heat index, and weather condition from deployed sensor nodes.</li>
                <li><strong style="color:var(--text-white);">Node telemetry</strong> — sensor node ID, battery level, status flags, uptime, and geographic placement coordinates.</li>
                <li><strong style="color:var(--text-white);">Administrator account</strong> — display name, email address, and a hashed password for the single system administrator. No public user accounts exist.</li>
                <li><strong style="color:var(--text-white);">Audit events</strong> — a log of system actions (sign-in, sign-out, sensor placement changes) for operational accountability.</li>
              </ul>

              <p style="font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-accent-light);margin:0 0 6px;">What We Do Not Collect</p>
              <ul style="color:var(--text-body);font-size:0.87rem;line-height:1.7;margin:0 0 16px;padding-left:18px;">
                <li>No personal data from members of the public.</li>
                <li>No cookies, browser fingerprints, or tracking of any kind.</li>
                <li>No data is transmitted to external servers — all data is stored locally on the device running ORCHID.</li>
              </ul>

              <p style="font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-accent-light);margin:0 0 6px;">How Data Is Used</p>
              <p style="color:var(--text-body);font-size:0.87rem;line-height:1.65;margin:0 0 16px;">
                Sensor data is used solely for real-time environmental monitoring, public health advisories, and historical climate analysis for Ormoc City. Audit logs are used for internal system accountability only.
              </p>

              <p style="font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-accent-light);margin:0 0 6px;">Data Storage & Security</p>
              <p style="color:var(--text-body);font-size:0.87rem;line-height:1.65;margin:0 0 4px;">
                All data is stored in a local SQLite database on the host device. The administrator password is stored as a salted hash — never in plain text. Access to system controls requires authentication.
              </p>
            </div>`,
          hideFooter: true,
        });
      });
    }
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      const label = item.querySelector('span')?.textContent.trim();
      if (label) {
        item.title = label;
        item.setAttribute('aria-label', label);
      }
      const href = (item.getAttribute('href') || '').toLowerCase();
      const navKey = item.getAttribute('data-nav');
      if (
        (currentPath.endsWith(href) && href !== '#' && href !== '' &&
          navKey !== 'heat-index' && navKey !== 'temperature') ||
        (currentPath.includes('map') && navKey === 'map') ||
        (currentPath.includes('sensor') && navKey === 'sensor') ||
        (currentPath.includes('heat') && navKey === (metric || 'heat-index')) ||
        (currentPath.endsWith('/management.html') && navKey === (managementView === 'audit' ? 'audit' : 'reports')) ||
        ((currentPath.endsWith('dashboard.html') || currentPath.endsWith('/') || currentPath === '') && navKey === 'dashboard')
      ) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  },

  initClockAndSync() {
    const syncEl = document.getElementById('sync-countdown');
    const updatedEl = document.getElementById('updated-time');
    const refreshIntervalMs = 1 * 60 * 1000;
    let nextRefreshAt = Date.now() + refreshIntervalMs;
    let refreshInProgress = false;

    // ── Receiver status badge ──────────────────────────────────────
    const pollReceiverStatus = async () => {
      const badge = document.getElementById('live-indicator');
      const text  = badge?.querySelector('.live-text');
      if (!badge) return;
      try {
        const res  = await fetch('/api/receiver/status');
        if (!res.ok) throw new Error(`Receiver status request failed (${res.status}).`);
        const data = await res.json();
        if (!data || typeof data.connected !== 'boolean') {
          throw new Error('Receiver status response was invalid.');
        }
        if (data.connected) {
          badge.classList.remove('badge-offline', 'badge-unknown');
          badge.setAttribute('aria-label', `USB serial device detected: ${data.device}`);
          badge.title = `${data.device}${data.description ? ` — ${data.description}` : ''}. USB presence does not confirm live sensor data.`;
          if (text) text.textContent = 'USB';
        } else {
          badge.classList.remove('badge-unknown');
          badge.classList.add('badge-offline');
          badge.setAttribute('aria-label', 'No USB serial device detected');
          badge.title = 'No USB serial device detected';
          if (text) text.textContent = 'Offline';
        }
      } catch (error) {
        console.error('Could not check for a USB serial receiver.', error);
        badge.classList.remove('badge-offline');
        badge.classList.add('badge-unknown');
        badge.setAttribute('aria-label', 'Receiver status unknown');
        badge.title = 'Could not check receiver';
        if (text) text.textContent = 'Unknown';
      }
    };
    pollReceiverStatus();
    window.setInterval(pollReceiverStatus, 10000); // re-check every 10 s
    // ──────────────────────────────────────────────────────────────

    const formatUpdatedTime = (date) => {
      const time = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(date);
      if (updatedEl) updatedEl.innerHTML = `Updated <strong>${time} PHT</strong>`;
    };

    let autoSyncCount = 0;
    const dispatchDataRefresh = () => {
      if (refreshInProgress) return;
      refreshInProgress = true;
      autoSyncCount++;
      nextRefreshAt = Date.now() + refreshIntervalMs;
      window.location.reload();
    };

    const renderCountdown = () => {
      if (!syncEl) return;
      const secondsUntilRefresh = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
      const minutes = Math.floor(secondsUntilRefresh / 60).toString().padStart(2, '0');
      const seconds = (secondsUntilRefresh % 60).toString().padStart(2, '0');
      syncEl.innerHTML = `Auto-refresh in <strong>${minutes}:${seconds}</strong>`;
      if (secondsUntilRefresh === 0) {
        dispatchDataRefresh();
      }
    };
    renderCountdown();
    window.setInterval(renderCountdown, 1000);
    formatUpdatedTime(new Date());

    const syncBtn = document.getElementById('btn-manual-sync');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        try {
          window.sessionStorage.setItem('orchid-page-refreshed', 'true');
        } catch (error) {
          console.error('Could not save the page-refresh notification.', error);
        }
        window.location.reload();
      });
    }

    // Avatar dropdown
    const avatarBtn = document.getElementById('btn-user-avatar');
    const dropdownMenu = document.getElementById('user-dropdown-menu');
    if (avatarBtn && dropdownMenu) {
      avatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isShown = dropdownMenu.classList.contains('show');
        dropdownMenu.classList.toggle('show', !isShown);
        avatarBtn.setAttribute('aria-expanded', !isShown);
      });
      document.addEventListener('click', () => {
        dropdownMenu.classList.remove('show');
        avatarBtn.setAttribute('aria-expanded', 'false');
      });
    }

    const settingsButton = document.getElementById('btn-system-settings');
    const profileModal = document.getElementById('profile-modal');
    const profileModalClose = document.getElementById('profile-modal-close');
    const profileModalStatus = document.getElementById('profile-modal-status');
    const profilePages = document.getElementById('profile-pages');
    let profileAccount = {
      display_name: document.querySelector('.user-name')?.textContent.trim() || 'System Officer',
      email: document.querySelector('.user-role')?.textContent.trim() || ''
    };
    const showAccountToast = (variant, title, message) => {
      window.OrchidToast.show({ variant, title, message });
    };
    const accountRequest = async (path, body) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Account request failed (${response.status}).`);
      return result;
    };
    const updateProfileHeader = () => {
      document.querySelectorAll('.user-name').forEach((el) => { el.textContent = profileAccount.display_name; });
      document.querySelectorAll('.user-role').forEach((el) => { el.textContent = profileAccount.email; });
      avatarBtn?.setAttribute('aria-label', `User Profile: ${profileAccount.display_name}`);
      avatarBtn?.setAttribute('data-tip', profileAccount.email);
      const identityName = profilePages?.querySelector('#profile-identity-name');
      const identityEmail = profilePages?.querySelector('#profile-identity-email');
      if (identityName) identityName.textContent = profileAccount.display_name;
      if (identityEmail) identityEmail.textContent = profileAccount.email;
    };
    const closeProfileModal = () => {
      if (!profileModal) return;
      profileModal.hidden = true;
      profileModal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      avatarBtn?.focus();
    };

    const openProfileEdit = (title, bodyHtml, onSubmit, onReady) => {
      if (!window.OrchidModal) {
        showAccountToast('error', 'Editor unavailable', 'Reload the page and try again.');
        return;
      }
      window.OrchidModal.open({
        title,
        bodyHtml: `
          <div class="profile-edit-auth">
            <div class="account-auth-brand">
              <span class="account-auth-mark" aria-hidden="true">O</span>
              <span>ORCHID · ADMINISTRATOR ACCESS</span>
            </div>
            <p class="account-auth-description" id="profile-edit-description"></p>
            ${bodyHtml}
          </div>`,
        hideFooter: true,
        profileEdit: true
      });
      const body = document.getElementById('orchid-modal-body');
      const descriptions = {
        'Edit display name': 'Update the name shown on your administrator profile.',
        'Change email address': 'Verify both email addresses to keep your account secure.',
        'Change password': 'Confirm it’s you with a one-time email code.'
      };
      body.querySelector('#profile-edit-description').textContent = descriptions[title] || '';
      const form = body.querySelector('#profile-edit-form');
      if (form) {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const submit = form.querySelector('[type="submit"]');
          submit.disabled = true;
          try {
            await onSubmit(form);
          } catch (error) {
            console.error(`Could not complete the ${title.toLowerCase()} flow.`, error);
            showAccountToast('error', 'Could not update settings', error.message);
          } finally {
            if (submit.isConnected) submit.disabled = false;
          }
        });
      }
      onReady?.(body);
    };

    profilePages?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-profile-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.profileAction;

      if (action === 'edit-name') {
        openProfileEdit('Edit display name', `
          <form id="profile-edit-form" class="account-auth-form profile-edit-form">
            <label class="profile-edit-field">Display name
              <input name="display_name" type="text" maxlength="80" autocomplete="name" value="${profileAccount.display_name.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" required />
            </label>
            <button class="btn btn-primary" type="submit">Save name</button>
          </form>`, async (form) => {
          const result = await accountRequest('/api/account/profile', {
            display_name: form.elements.display_name.value
          });
          profileAccount.display_name = result.display_name;
          profilePages.querySelector('#profile-name-value').textContent = result.display_name;
          updateProfileHeader();
          window.OrchidModal.close();
          showAccountToast('success', 'Name updated', 'Your administrator name was updated.');
        }, (body) => body.querySelector('[name="display_name"]').focus());
        return;
      }

      if (action === 'edit-email') {
        openProfileEdit('Change email address', `
          <form id="profile-edit-form" class="account-auth-form profile-edit-form" data-step="email">
            <label class="profile-edit-field">New email address
              <input name="new_email" type="email" maxlength="254" autocomplete="email" required placeholder="name@example.invalid" />
            </label>
            <button class="btn btn-primary" type="submit">Send verification codes</button>
          </form>`, async (form) => {
          if (form.dataset.step === 'email') {
            const result = await accountRequest('/api/account/email/request', {
              new_email: form.elements.new_email.value
            });
            body.querySelector('#profile-edit-description').textContent =
              'Enter both six-digit codes to verify and save your new email.';
            form.dataset.step = 'verify-email';
            form.innerHTML = `
              <p class="profile-edit-intro">Codes sent to ${result.sent_to.map((email) => `<strong>${email.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</strong>`).join(' and ')}.</p>
              <label class="profile-edit-field">Code sent to current email
                <input name="current_code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
              </label>
              <label class="profile-edit-field">Code sent to new email
                <input name="new_code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required />
              </label>
              <button class="btn btn-primary" type="submit">Verify and save email</button>`;
            form.querySelector('[name="current_code"]').focus();
            showAccountToast('success', 'Verification codes sent', 'Check both email addresses for a code.');
            return;
          }
          const result = await accountRequest('/api/account/email/verify', {
            current_code: form.elements.current_code.value.trim(),
            new_code: form.elements.new_code.value.trim()
          });
          profileAccount.email = result.email;
          profilePages.querySelector('#profile-email-value').textContent = result.email;
          updateProfileHeader();
          window.OrchidModal.close();
          showAccountToast('success', 'Email updated', 'Your new email was verified and saved.');
        }, (body) => body.querySelector('[name="new_email"]').focus());
        return;
      }

      if (action === 'edit-password') {
        openProfileEdit('Change password', `
          <div class="profile-edit-form">
            <button class="btn btn-primary" id="profile-send-password-code" type="button">Send verification code</button>
          </div>`, null, (body) => {
          body.querySelector('#profile-send-password-code').addEventListener('click', async (event) => {
            const sendButton = event.currentTarget;
            sendButton.disabled = true;
            try {
              const result = await accountRequest('/api/account/password/request');
              body.querySelector('#profile-edit-description').textContent =
                `A verification code was sent to ${result.sent_to}. Enter it below to continue.`;
              const form = document.createElement('form');
              form.id = 'profile-edit-form';
              form.className = 'account-auth-form profile-edit-form';
              form.innerHTML = `
                <label class="profile-edit-field">Verification code
                  <input name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
                </label>
                <label class="profile-edit-field">New password
                  <input name="new_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
                </label>
                <label class="profile-edit-field">Confirm new password
                  <input name="confirm_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
                </label>
                <button class="btn btn-primary" type="submit">Save password</button>`;
              body.querySelector('.profile-edit-auth').appendChild(form);
              body.querySelector('#profile-send-password-code').remove();
              form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const submit = form.querySelector('[type="submit"]');
                submit.disabled = true;
                try {
                  if (form.elements.new_password.value !== form.elements.confirm_password.value) {
                    throw new Error('The new passwords do not match.');
                  }
                  await accountRequest('/api/account/password/verify', {
                    code: form.elements.code.value.trim(),
                    new_password: form.elements.new_password.value
                  });
                  window.OrchidModal.close();
                  showAccountToast('success', 'Password updated', 'Your administrator password was changed.');
                } catch (error) {
                  console.error('Could not complete the password change.', error);
                  showAccountToast('error', 'Could not update settings', error.message);
                } finally {
                  if (submit.isConnected) submit.disabled = false;
                }
              });
              form.querySelector('[name="code"]').focus();
              showAccountToast('success', 'Verification code sent', `A code was sent to ${result.sent_to}.`);
            } catch (error) {
              console.error('Could not request an ORCHID password verification code.', error);
              showAccountToast('error', 'Could not send code', error.message);
              sendButton.disabled = false;
            }
          });
        });
      }
    });

    profileModalClose?.addEventListener('click', closeProfileModal);
    profileModal?.addEventListener('click', (event) => {
      if (event.target === profileModal) closeProfileModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && profileModal && !profileModal.hidden) closeProfileModal();
    });

    settingsButton?.addEventListener('click', () => {
      dropdownMenu?.classList.remove('show');
      avatarBtn?.setAttribute('aria-expanded', 'false');
      if (!profileModal || !profileModalStatus) {
        window.OrchidToast.show({
          variant: 'error',
          title: 'Settings unavailable',
          message: 'The profile popup could not be opened. Reload the page and try again.'
        });
        return;
      }
      profileModal.hidden = false;
      profileModal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      document.getElementById('profile-modal-title').textContent = 'System Settings';
      document.getElementById('profile-modal-meta').textContent = 'Administrator profile';
      profileModal.querySelector('#profile-pages').innerHTML = `
        <div class="profile-page" id="profile-page-main">
          <section class="profile-identity">
            <div class="profile-identity-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </div>
            <div class="profile-identity-copy">
              <span class="profile-identity-label">Administrator account</span>
              <strong id="profile-identity-name"></strong>
              <span id="profile-identity-email"></span>
            </div>
            <span class="profile-secure-badge"><span aria-hidden="true"></span> Secure</span>
          </section>
          <p class="profile-settings-caption">Manage your sign-in details</p>
          <section class="profile-setting-card">
            <button class="profile-edit-icon" type="button" data-profile-action="edit-name" aria-label="Edit display name" title="Edit display name">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
            </button>
            <div class="profile-setting-copy">
              <span>Display name</span>
              <strong id="profile-name-value"></strong>
            </div>
          </section>
          <section class="profile-setting-card">
            <button class="profile-edit-icon" type="button" data-profile-action="edit-email" aria-label="Edit email address" title="Edit email address">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
            </button>
            <div class="profile-setting-copy">
              <span>Email address</span>
              <strong id="profile-email-value"></strong>
            </div>
          </section>
          <section class="profile-setting-card">
            <button class="profile-edit-icon" type="button" data-profile-action="edit-password" aria-label="Change password" title="Change password">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
            </button>
            <div class="profile-setting-copy">
              <span>Password</span>
              <strong>••••••••••</strong>
              <small>Protected with email verification</small>
            </div>
          </section>
        </div>`;
      profilePages.querySelector('#profile-name-value').textContent = profileAccount.display_name;
      profilePages.querySelector('#profile-email-value').textContent = profileAccount.email || '—';
      profilePages.querySelector('#profile-identity-name').textContent = profileAccount.display_name;
      profilePages.querySelector('#profile-identity-email').textContent = profileAccount.email || 'Administrator';
      profileModalStatus.textContent = '';
      profileModalClose?.focus();
      if (window.OrchidComponentLoader.mockMode) {
        profilePages.querySelectorAll('[data-profile-action]').forEach((button) => { button.disabled = true; });
        showAccountToast('warning', 'Demo mode', 'Profile changes are disabled while ORCHID is using demo data.');
      }
    });
    const logoutButton = document.getElementById('btn-logout');
    logoutButton?.addEventListener('click', async () => {
      logoutButton.disabled = true;
      try {
        const response = await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not sign out.');
        window.OrchidToast.show({
          variant: 'success',
          title: 'Signed out',
          message: 'You have been signed out of ORCHID.',
          duration: 1600
        });
        window.setTimeout(() => window.location.reload(), 1700);
      } catch (error) {
        logoutButton.disabled = false;
        console.error('Could not sign out of ORCHID.', error);
        window.OrchidToast.show({ variant: 'error', title: 'Sign out failed', message: error.message });
      }
    });
  },

  initHeaderTooltips() {
    const tip = document.createElement('div');
    tip.id = 'orchid-header-tooltip';
    document.body.appendChild(tip);

    const positionTip = (event) => {
      if (event.currentTarget.closest('.orchid-dropdown')?.querySelector('[aria-expanded="true"]')) {
        tip.style.opacity = '0';
        return;
      }
      const left = Math.max(8, Math.min(
        event.clientX - tip.offsetWidth / 2,
        window.innerWidth - tip.offsetWidth - 8
      ));
      let top = event.clientY - tip.offsetHeight - 12;
      if (top < 8) top = event.clientY + 20;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };

    document.querySelectorAll('[data-tip]').forEach((element) => {
      element.addEventListener('mouseenter', (event) => {
        tip.textContent = element.getAttribute('data-tip');
        tip.style.opacity = '1';
        positionTip(event);
      });
      element.addEventListener('mousemove', positionTip);
      element.addEventListener('mouseleave', () => {
        tip.style.opacity = '0';
      });
      element.addEventListener('focus', () => {
        if (element.closest('.orchid-dropdown')?.querySelector('[aria-expanded="true"]')) return;
        const rect = element.getBoundingClientRect();
        tip.textContent = element.getAttribute('data-tip');
        tip.style.opacity = '1';
        const left = Math.max(8, Math.min(
          rect.left + rect.width / 2 - tip.offsetWidth / 2,
          window.innerWidth - tip.offsetWidth - 8
        ));
        const top = rect.top - tip.offsetHeight - 12 >= 8
          ? rect.top - tip.offsetHeight - 12
          : rect.bottom + 20;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
        element.setAttribute('aria-describedby', tip.id);
      });
      element.addEventListener('blur', () => {
        tip.style.opacity = '0';
        element.removeAttribute('aria-describedby');
      });
    });
  },

  initWeatherDropdown() {
    const trigger = document.getElementById('weather-pill-trigger');
    const dropdown = document.getElementById('weather-dropdown');
    const refreshBtn = document.getElementById('btn-weather-refresh');
    if (!trigger || !dropdown) return;

    const pillTemperature = trigger.querySelector('strong');
    const pillCondition = trigger.querySelector('span');
    const mainTemperature = dropdown.querySelector('.weather-main-temp');
    const mainCondition = dropdown.querySelector('.weather-main-desc');
    const feelsLike = dropdown.querySelector('.weather-main-feels');
    const statValues = dropdown.querySelectorAll('.weather-stat-value');
    const updatedTime = document.getElementById('weather-updated-time');
    const weatherCacheKey = 'orchid-city-weather';
    const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
    weatherUrl.search = new URLSearchParams({
      latitude: '11.00639',
      longitude: '124.6075',
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
      timezone: 'Asia/Manila',
      wind_speed_unit: 'ms'
    }).toString();
    const weatherDescriptions = {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Fog',
      48: 'Depositing rime fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      56: 'Light freezing drizzle',
      57: 'Dense freezing drizzle',
      61: 'Slight rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      66: 'Light freezing rain',
      67: 'Heavy freezing rain',
      71: 'Slight snowfall',
      73: 'Moderate snowfall',
      75: 'Heavy snowfall',
      77: 'Snow grains',
      80: 'Slight rain showers',
      81: 'Moderate rain showers',
      82: 'Violent rain showers',
      85: 'Slight snow showers',
      86: 'Heavy snow showers',
      95: 'Thunderstorm',
      96: 'Thunderstorm with slight hail',
      99: 'Thunderstorm with heavy hail'
    };

    const formatValue = (value, unit, decimals = 0) =>
      Number.isFinite(value) ? `${Number(value.toFixed(decimals))}${unit === '%' ? '%' : ` ${unit}`}` : '—';

    const formatDirection = (degrees) => {
      if (!Number.isFinite(degrees)) return '—';
      const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      return directions[Math.round(degrees / 22.5) % directions.length];
    };

    const renderWeather = (weather, { stale = false } = {}) => {
      const condition = weatherDescriptions[weather.weather_code] || 'Weather condition unavailable';
      const temperature = formatValue(weather.temperature_2m, '°C', 1);
      if (pillTemperature) pillTemperature.textContent = temperature;
      if (pillCondition) pillCondition.textContent = stale ? `${condition} · Offline` : condition;
      if (mainTemperature) mainTemperature.textContent = temperature;
      if (mainCondition) mainCondition.textContent = condition;
      if (feelsLike) {
        feelsLike.textContent = `Feels like ${formatValue(weather.apparent_temperature, '°C', 1)}`;
      }
      const values = [
        formatValue(weather.relative_humidity_2m, '%'),
        formatValue(weather.precipitation, 'mm', 1),
        formatValue(weather.wind_speed_10m, 'm/s', 1),
        formatDirection(weather.wind_direction_10m)
      ];
      values.forEach((value, index) => {
        if (statValues[index]) statValues[index].textContent = value;
      });
      if (updatedTime) {
        const observationTime = new Date(`${weather.time}+08:00`);
        const formattedTime = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Manila',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }).format(observationTime);
        updatedTime.textContent = `${stale ? 'Last observation' : 'Observed'} ${formattedTime} PHT${stale ? ' · Offline' : ''}`;
      }
      dropdown.dataset.weatherState = stale ? 'offline' : 'loaded';
    };

    const loadCachedWeather = () => {
      try {
        const cached = window.localStorage.getItem(weatherCacheKey);
        if (!cached) return false;
        const { weather, cachedAt } = JSON.parse(cached);
        if (!weather || !Number.isFinite(weather.temperature_2m) || !weather.time || !cachedAt) {
          throw new Error('Cached weather has an invalid format.');
        }
        renderWeather(weather, { stale: true });
        window.ORCHID_CITY_WEATHER = { ...weather, source: 'Open-Meteo', stale: true };
        return true;
      } catch (error) {
        console.error('Could not read cached Ormoc City weather.', error);
        return false;
      }
    };

    let weatherRequestInProgress = false;
    const refreshWeather = async () => {
      if (weatherRequestInProgress) return { status: 'in-progress' };
      weatherRequestInProgress = true;
      const controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller.abort(), 10000);
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.setAttribute('aria-label', 'Refreshing weather');
        refreshBtn.classList.add('rotating');
      }

      try {
        const response = await fetch(weatherUrl, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}.`);
        const result = await response.json();
        const current = result.current;
        if (!current || !Number.isFinite(current.temperature_2m) ||
            typeof current.time !== 'string' || !Number.isFinite(current.weather_code)) {
          throw new Error('Open-Meteo returned incomplete current weather data.');
        }

        renderWeather(current);
        try {
          window.localStorage.setItem(weatherCacheKey, JSON.stringify({
            weather: current,
            cachedAt: new Date().toISOString()
          }));
        } catch (error) {
          console.error('Could not cache Ormoc City weather for offline use.', error);
        }
        const cityWeather = {
          ...current,
          condition: weatherDescriptions[current.weather_code] || 'Weather condition unavailable',
          source: 'Open-Meteo',
          stale: false
        };
        window.ORCHID_CITY_WEATHER = cityWeather;
        window.dispatchEvent(new CustomEvent('orchid:city-weather-updated', { detail: cityWeather }));
        return { status: 'fresh' };
      } catch (error) {
        console.warn('Could not load live Ormoc City weather from Open-Meteo.', error);
        if (loadCachedWeather()) {
          window.dispatchEvent(new CustomEvent('orchid:city-weather-updated', {
            detail: window.ORCHID_CITY_WEATHER
          }));
          return { status: 'offline' };
        }
        window.ORCHID_CITY_WEATHER = null;
        window.dispatchEvent(new CustomEvent('orchid:city-weather-updated', { detail: null }));
        if (pillTemperature) pillTemperature.textContent = '—';
        if (pillCondition) pillCondition.textContent = 'Offline';
        if (mainTemperature) mainTemperature.textContent = '—';
        if (mainCondition) mainCondition.textContent = 'Weather unavailable offline';
        if (feelsLike) feelsLike.textContent = 'Connect to the internet to load live weather.';
        statValues.forEach((element) => { element.textContent = '—'; });
        if (updatedTime) updatedTime.textContent = 'No saved observation · Offline';
        dropdown.dataset.weatherState = 'offline';
        return { status: 'unavailable' };
      } finally {
        window.clearTimeout(requestTimeout);
        weatherRequestInProgress = false;
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.setAttribute('aria-label', 'Refresh weather');
          refreshBtn.classList.remove('rotating');
        }
      }
    };

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        const result = await refreshWeather();
        if (result?.status === 'fresh') {
          window.OrchidToast.show({
            variant: 'success',
            title: 'Weather refreshed',
            message: 'Ormoc City weather has been updated from Open-Meteo.'
          });
        } else if (result?.status === 'offline') {
          window.OrchidToast.show({
            variant: 'warning',
            title: 'Weather is offline',
            message: 'Showing the last weather observation saved on this device.'
          });
        } else if (result?.status === 'unavailable') {
          window.OrchidToast.show({
            variant: 'warning',
            title: 'Weather unavailable offline',
            message: 'No saved weather is available. Reconnect and try again.'
          });
        }
      });
    }
    loadCachedWeather();
    refreshWeather();

    const setDropdownOpen = (isOpen) => {
      dropdown.classList.toggle('show', isOpen);
      dropdown.setAttribute('aria-hidden', String(!isOpen));
      trigger.setAttribute('aria-expanded', String(isOpen));
    };

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      setDropdownOpen(!dropdown.classList.contains('show'));
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setDropdownOpen(!dropdown.classList.contains('show'));
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dropdown.classList.contains('show')) {
        setDropdownOpen(false);
        trigger.focus();
      }
    });

    document.addEventListener('click', (event) => {
      if (!dropdown.contains(event.target) && !trigger.contains(event.target)) {
        setDropdownOpen(false);
      }
    });
  },

  initDoubleSubmitProtection() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-double-submit="prevent"], .btn-prevent-double');
      if (!btn || btn.disabled) return;

      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.dataset.originalHtml = originalHtml;

      const spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      btn.prepend(spinner);

      setTimeout(() => {
        if (btn.isConnected) {
          btn.disabled = false;
          const sp = btn.querySelector('.btn-spinner');
          if (sp) sp.remove();
        }
      }, 3000);
    });
  }
};

/**
 * OrchidChart — reusable inline SVG sparkline component.
 *
 * Usage:
 *   const chart = window.OrchidChart.create(containerEl, {
 *     color:       'var(--color-accent-hover)',   // stroke colour (defaults to the shared accent token)
 *     fillColor:   'var(--color-accent-hover)',   // fill tint colour (defaults to the stroke colour)
 *     smooth:      true,        // cubic-bezier smoothing (default: true)
 *     height:      48,          // SVG height in px (default: 48)
 *     padding:     4,           // vertical inset so strokes aren't clipped (default: 4)
 *   });
 *
 *   chart.update([28.5, 28.9, 29.2, 28.7, 29.0]);  // re-draw with new data
 *   chart.clear();                                   // remove SVG, show empty state
 *
 * The container's CSS width drives the SVG width automatically via viewBox.
 */
window.OrchidChart = (function () {
  'use strict';

  /**
   * Map a value from one range to another.
   * @param {number} value
   * @param {number} inMin
   * @param {number} inMax
   * @param {number} outMin
   * @param {number} outMax
   */
  function mapRange(value, inMin, inMax, outMin, outMax) {
    if (inMin === inMax) return (outMin + outMax) / 2;
    return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
  }

  /**
   * Build a smooth SVG path string from a set of (x, y) points using
   * cardinal cubic-bezier splines, or a plain polyline when smooth=false.
   * @param {{ x: number, y: number }[]} points
   * @param {boolean} smooth
   */
  function buildPath(points, smooth) {
    if (points.length < 2) return '';
    if (!smooth) {
      return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    }
    // Catmull-Rom → cubic Bezier conversion (tension = 0.4)
    const t = 0.4;
    let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) * t;
      const cp1y = p1.y + (p2.y - p0.y) * t;
      const cp2x = p2.x - (p3.x - p1.x) * t;
      const cp2y = p2.y - (p3.y - p1.y) * t;
      d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
    return d;
  }

  /**
   * Create a sparkline instance attached to `container`.
   * @param {Element} container
   * @param {object}  opts
   */
  function create(container, opts = {}) {
    const color     = opts.color     || getComputedStyle(document.documentElement).getPropertyValue('--color-accent-hover').trim() || '#5274aa';
    const fillColor = opts.fillColor || color;
    const smooth    = opts.smooth    !== false;
    const height    = opts.height    || 48;
    const padding   = opts.padding   !== undefined ? opts.padding : 4;
    const W         = 200; // logical viewport width — scales with CSS

    const ns = 'http://www.w3.org/2000/svg';
    const uid = `oc-${Math.random().toString(36).slice(2, 8)}`;

    // Build the SVG skeleton once
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('orchid-sparkline-svg');

    // Gradient fill definition
    const defs = document.createElementNS(ns, 'defs');
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', uid);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    const stop1 = document.createElementNS(ns, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', fillColor);
    stop1.setAttribute('stop-opacity', '0.22');
    const stop2 = document.createElementNS(ns, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', fillColor);
    stop2.setAttribute('stop-opacity', '0');
    grad.append(stop1, stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Area fill path (under the line)
    const fillPath = document.createElementNS(ns, 'path');
    fillPath.setAttribute('fill', `url(#${uid})`);
    fillPath.setAttribute('stroke', 'none');
    svg.appendChild(fillPath);

    // Stroke line path (the sparkline itself)
    const linePath = document.createElementNS(ns, 'path');
    linePath.setAttribute('fill', 'none');
    linePath.setAttribute('stroke', color);
    linePath.setAttribute('stroke-width', '2');
    linePath.setAttribute('stroke-linecap', 'round');
    linePath.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(linePath);

    container.appendChild(svg);

    /** Re-draw the sparkline with a fresh data array of numbers. */
    function update(values) {
      if (!Array.isArray(values) || values.length < 2) {
        linePath.removeAttribute('d');
        fillPath.removeAttribute('d');
        return;
      }

      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      const drawH  = height - padding * 2;

      const points = values.map((v, i) => ({
        x: mapRange(i, 0, values.length - 1, 0, W),
        y: mapRange(v, minVal, maxVal, padding + drawH, padding)
      }));

      const strokeD = buildPath(points, smooth);
      linePath.setAttribute('d', strokeD);

      // Close the fill area down to the bottom edge
      const lastP = points[points.length - 1];
      const firstP = points[0];
      const areaD = `${strokeD} L${lastP.x.toFixed(2)},${height} L${firstP.x.toFixed(2)},${height} Z`;
      fillPath.setAttribute('d', areaD);
    }

    /** Remove the SVG from the DOM. */
    function clear() {
      svg.remove();
    }

    return { update, clear, svg };
  }

  return { create };
}());

document.addEventListener('DOMContentLoaded', () => {
  window.OrchidComponentLoader.init().catch((error) => {
    console.error('Failed to initialize shared page components.', error);
    const alert = document.createElement('p');
    alert.className = 'component-load-error';
    alert.setAttribute('role', 'alert');
    alert.textContent = 'Shared page components could not be loaded. Start the local server and reload this page.';
    document.body.prepend(alert);
  });
});
