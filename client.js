window.__ModuleLoader__.load({
  id: 'dsh-g1-ssh',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'g1-ssh'
    const ENTRY_ID = 'g1-ssh'
    const DEFAULT_HOST = { wifi: '192.168.10.183', wired: '192.168.123.161' }

    const zh = {
      nav: 'G1 机器人',
      title: 'G1 机器人连接',
      desc: '通过 SSH 连接宇树 G1。连接信息只保存在本机；密码不会回传到浏览器。',
      loading: '正在读取连接设置…',
      unavailable: '当前 profile 没有提供可编辑的 G1 连接配置（settings 服务不可用）。',
      'mode.label': '连接方式',
      'mode.wifi': '无线（Wi-Fi）',
      'mode.wired': '有线（网线）',
      'mode.hint': '无线：G1 和电脑连在同一个路由器上；有线：用网线直连 G1，电脑使用 192.168.123.x 网段。',
      'host.label': 'G1 的 IP 地址',
      'user.label': 'SSH 用户名',
      'password.label': 'SSH 密码',
      'password.placeholder': '输入 unitree 用户的密码',
      'password.keep': '留空则保持已保存的密码',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，G1 工具会立即使用新配置。',
      skip: '稍后设置',
      'error.host': '请填写 G1 的 IP 地址。',
      'error.user': '请填写 SSH 用户名。',
      'error.password': '首次设置需要填写 SSH 密码。',
      'error.save': '保存失败，请重试。',
      'modal.title': '连接你的 G1',
      'modal.desc': '选择无线或有线连接，填写 G1 的 IP 地址和 SSH 密码。保存后 agent 就能直接操作机器人。',
    }

    const en = {
      nav: 'G1 Robot',
      title: 'G1 robot connection',
      desc: 'Connect to a Unitree G1 over SSH. Settings stay on this machine; the password is never sent back to the browser.',
      loading: 'Loading connection settings…',
      unavailable: 'This profile exposes no editable G1 connection settings (settings service unavailable).',
      'mode.label': 'Connection',
      'mode.wifi': 'Wireless (Wi-Fi)',
      'mode.wired': 'Wired (Ethernet)',
      'mode.hint': 'Wireless: the G1 shares your router. Wired: connect the cable directly and use the 192.168.123.x network.',
      'host.label': 'G1 IP address',
      'user.label': 'SSH user',
      'password.label': 'SSH password',
      'password.placeholder': 'Password of the unitree user',
      'password.keep': 'Leave empty to keep the saved password',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. G1 tools use the new settings immediately.',
      skip: 'Set up later',
      'error.host': 'Enter the G1 IP address.',
      'error.user': 'Enter the SSH user.',
      'error.password': 'The first setup needs the SSH password.',
      'error.save': 'Saving failed. Try again.',
      'modal.title': 'Connect your G1',
      'modal.desc': 'Choose wireless or wired, then enter the G1 IP address and SSH password. After saving, the agent can operate the robot directly.',
    }

    const CSS = [
      '.g1x-panel{display:flex;flex-direction:column;gap:6px;padding:4px 0 12px;max-width:560px;color:var(--dsw-alias-label-primary);font-size:13px}',
      '.g1x-title{font-size:15px;font-weight:600;line-height:22px}',
      '.g1x-desc,.g1x-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0}',
      '.g1x-form{display:flex;flex-direction:column;margin-top:8px}',
      '.g1x-label{font-size:12px;font-weight:500;margin:14px 0 6px;color:var(--dsw-alias-label-primary)}',
      '.g1x-seg{display:flex;gap:8px}',
      '.g1x-seg-btn{flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}',
      '.g1x-seg-btn[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.g1x-input{height:36px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 10px;font-size:13px;outline:none;width:100%;box-sizing:border-box}',
      '.g1x-input:focus-visible{border-color:var(--dsw-alias-brand-primary)}',
      '.g1x-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:12px}',
      '.g1x-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;margin-top:12px}',
      '.g1x-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}',
      '.g1x-btn{height:34px;padding:0 14px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}',
      '.g1x-btn:disabled{opacity:.55;cursor:default}',
      '.g1x-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.g1x-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}',
      '.g1x-dialog{width:min(520px,100%);max-height:calc(100vh - 48px);overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:22px;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:0 24px 64px rgba(0,0,0,.32)}',
    ].join('')

    /** Component-local stylesheet: unmounting the component removes it. */
    function Style() {
      return h('style', { dangerouslySetInnerHTML: { __html: CSS } })
    }

    /** Persist one complete profile through the settings form controller. */
    async function saveValues(form, values) {
      const ops = [
        { op: 'set', path: ['mode'], value: values.mode },
        { op: 'set', path: ['host'], value: values.host },
        { op: 'set', path: ['user'], value: values.user },
        { op: 'set', path: ['setupDone'], value: true },
      ]
      if (typeof values.password === 'string' && values.password !== '') {
        ops.push({ op: 'set', path: ['password'], value: values.password })
      }
      return form.mutate(ops)
    }

    /** Keep Tab focus inside the dialog while it is open. */
    function trapTab(event, dialog) {
      if (dialog === null || dialog === undefined) return
      const nodes = Array.from(dialog.querySelectorAll('button, input, select, textarea, a[href]'))
        .filter((node) => node.disabled !== true)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    /** One labeled input row. */
    function field(label, input) {
      return h('div', { className: 'g1x-field' }, h('label', { className: 'g1x-label' }, label), input)
    }

    /**
     * Shared setup form. Draft values reset from the saved revision, so a
     * successful write clears the password box and shows the stored profile.
     */
    function G1Form({ t, initial, revision, onSave, onSkip }) {
      const [mode, setMode] = React.useState(initial.mode)
      const [host, setHost] = React.useState(initial.host)
      const [user, setUser] = React.useState(initial.user)
      const [password, setPassword] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [saved, setSaved] = React.useState(false)

      React.useEffect(() => {
        setMode(initial.mode)
        setHost(initial.host)
        setUser(initial.user)
        setPassword('')
        setError(null)
      }, [revision])

      const chooseMode = (next) => {
        setMode(next)
        setSaved(false)
        setHost((current) => (current === '' || current === DEFAULT_HOST[mode] || current === DEFAULT_HOST[next] ? DEFAULT_HOST[next] : current))
      }

      const submit = async (event) => {
        event.preventDefault()
        const nextHost = host.trim()
        const nextUser = user.trim()
        setSaved(false)
        if (nextHost === '') {
          setError(t('error.host'))
          return
        }
        if (nextUser === '') {
          setError(t('error.user'))
          return
        }
        if (initial.requirePassword === true && password === '') {
          setError(t('error.password'))
          return
        }
        setBusy(true)
        setError(null)
        try {
          const ok = await onSave({ mode, host: nextHost, user: nextUser, password })
          if (ok) {
            setSaved(true)
            setPassword('')
          } else {
            setError(t('error.save'))
          }
        } catch (failure) {
          setError(failure !== null && typeof failure === 'object' && typeof failure.message === 'string' ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }

      return h('form', { className: 'g1x-form', onSubmit: submit, noValidate: true },
        h('div', { className: 'g1x-label' }, t('mode.label')),
        h('div', { className: 'g1x-seg', role: 'radiogroup', 'aria-label': t('mode.label') },
          h('button', {
            type: 'button',
            className: 'g1x-seg-btn',
            'aria-pressed': mode === 'wifi',
            onClick: () => chooseMode('wifi'),
          }, t('mode.wifi')),
          h('button', {
            type: 'button',
            className: 'g1x-seg-btn',
            'aria-pressed': mode === 'wired',
            onClick: () => chooseMode('wired'),
          }, t('mode.wired'))),
        h('p', { className: 'g1x-hint' }, t('mode.hint')),
        field(t('host.label'), h('input', {
          className: 'g1x-input',
          type: 'text',
          value: host,
          placeholder: DEFAULT_HOST[mode],
          autoComplete: 'off',
          spellCheck: false,
          onChange: (event) => {
            setHost(event.target.value)
            setSaved(false)
          },
        })),
        field(t('user.label'), h('input', {
          className: 'g1x-input',
          type: 'text',
          value: user,
          autoComplete: 'username',
          spellCheck: false,
          onChange: (event) => {
            setUser(event.target.value)
            setSaved(false)
          },
        })),
        field(t('password.label'), h('input', {
          className: 'g1x-input',
          type: 'password',
          value: password,
          placeholder: initial.requirePassword === true ? t('password.placeholder') : t('password.keep'),
          autoComplete: 'current-password',
          onChange: (event) => {
            setPassword(event.target.value)
            setSaved(false)
          },
        })),
        error === null ? null : h('div', { className: 'g1x-error', role: 'alert' }, error),
        saved ? h('div', { className: 'g1x-ok', role: 'status' }, t('saved')) : null,
        h('div', { className: 'g1x-actions' },
          onSkip === undefined ? null : h('button', {
            type: 'button',
            className: 'g1x-btn',
            onClick: onSkip,
          }, t('skip')),
          h('button', {
            type: 'submit',
            className: 'g1x-btn g1x-btn-primary',
            disabled: busy,
          }, busy ? t('saving') : t('save'))))
    }

    /** Settings page: view and change the connection at any time. */
    function G1Section({ useG1Form, save, t }) {
      const state = useG1Form((snapshot) => snapshot)
      if (state.status !== 'ready' || state.value === undefined) {
        return h('div', { className: 'g1x-panel' },
          h(Style),
          h('div', { className: 'g1x-title' }, t('title')),
          h('p', { className: 'g1x-desc' }, state.status === 'loading' ? t('loading') : t('unavailable')))
      }
      const value = state.value
      const mode = value.mode === 'wired' ? 'wired' : 'wifi'
      return h('div', { className: 'g1x-panel' },
        h(Style),
        h('div', { className: 'g1x-title' }, t('title')),
        h('p', { className: 'g1x-desc' }, t('desc')),
        h(G1Form, {
          t,
          revision: state.revision,
          initial: {
            mode,
            host: typeof value.host === 'string' && value.host !== '' ? value.host : DEFAULT_HOST[mode],
            user: typeof value.user === 'string' && value.user !== '' ? value.user : 'unitree',
            requirePassword: false,
          },
          onSave: save,
        }))
    }

    /** First-run step: modal until a profile has been saved once. */
    function G1Onboarding({ useG1Form, save, complete, t }) {
      const state = useG1Form((snapshot) => snapshot)
      const ready = state.status === 'ready' && state.value !== undefined
      const done = ready && state.value.setupDone === true
      const unavailable = state.status === 'unavailable'
      const open = ready && !done
      const dialogRef = React.useRef(null)

      React.useEffect(() => {
        if (done || unavailable) complete()
      }, [done, unavailable])

      React.useEffect(() => {
        if (!open) return undefined
        const root = document.getElementById('root')
        const previous = root === null ? undefined : root.inert
        if (root !== null) root.inert = true
        return () => {
          if (root !== null) root.inert = previous === true
        }
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        const dialog = dialogRef.current
        const focusable = dialog === null ? null : dialog.querySelector('input, button')
        if (focusable !== null) focusable.focus()
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            complete()
          } else if (event.key === 'Tab') {
            trapTab(event, dialogRef.current)
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [open])

      if (!open) return null
      const value = state.value
      const mode = value.mode === 'wired' ? 'wired' : 'wifi'
      return ReactDOM.createPortal(
        h('div', { className: 'g1x-backdrop' },
          h(Style),
          h('div', {
            className: 'g1x-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'g1x-modal-title',
            ref: dialogRef,
          },
            h('div', { className: 'g1x-title', id: 'g1x-modal-title' }, t('modal.title')),
            h('p', { className: 'g1x-desc' }, t('modal.desc')),
            h(G1Form, {
              t,
              revision: state.revision,
              initial: {
                mode,
                host: typeof value.host === 'string' && value.host !== '' ? value.host : DEFAULT_HOST[mode],
                user: typeof value.user === 'string' && value.user !== '' ? value.user : 'unitree',
                requirePassword: true,
              },
              onSave: save,
              onSkip: complete,
            }))),
        document.body)
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-g1-ssh: dictionaries')
      const t = ctx.locale.bind(NS)
      const form = ctx.configForms.get(ENTRY_ID)
      const save = (values) => saveValues(form, values)
      const injected = () => ({
        form,
        hooks: { g1Form: form.store },
        save,
      })

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'g1-robot',
        order: 25,
        label: () => t('nav'),
        locale: NS,
        inject: injected,
      }, G1Section))

      ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
        name: 'settings.onboarding',
        id: 'g1-setup',
        order: 50,
        locale: NS,
        inject: injected,
      }, G1Onboarding))
    }

    const inject = ['slots', 'locale', 'configForms']

    return { apply, inject }
  },
})
