import { useState } from 'react'
import type { FormEvent } from 'react'
import { loginUser /*, registerUser */ } from '@/api' // v1.5: 注册入口隐藏，registerUser 暂时不用
import type { User } from '@/api'

/* v1.5: 注册 tab 已隐藏，仅保留登录。恢复时取消下方注册相关代码的注释即可。 */
// type Tab = 'login' | 'register'

/* v2.0 前台文案改为繁体，但服务器存的儿童姓氏是简体。
   孩子若按界面提示输入繁体姓氏（如「張」），登录前归一为简体（「张」）再匹配。
   先替换常见复姓（双字），再逐字替换单字。 */
const TRAD_COMPOUND: [string, string][] = [
  ['歐陽', '欧阳'],
  ['司馬', '司马'],
  ['諸葛', '诸葛'],
  ['夏侯', '夏侯'],
  ['司徒', '司徒'],
  ['令狐', '令狐'],
  ['慕容', '慕容'],
  ['皇甫', '皇甫'],
  ['尉遲', '尉迟'],
  ['公孫', '公孙'],
  ['長孫', '长孙'],
  ['宇文', '宇文'],
  ['鮮于', '鲜于'],
  ['上官', '上官'],
]
const TRAD_SINGLE: Record<string, string> = {
  張: '张', 劉: '刘', 陳: '陈', 楊: '杨', 黃: '黄', 趙: '赵', 吳: '吴', 孫: '孙',
  馬: '马', 羅: '罗', 鄭: '郑', 謝: '谢', 許: '许', 韓: '韩', 馮: '冯', 鄧: '邓',
  蕭: '萧', 於: '于', 蔣: '蒋', 葉: '叶', 蘇: '苏', 呂: '吕', 盧: '卢', 鍾: '钟',
  譚: '谭', 陸: '陆', 賈: '贾', 韋: '韦', 鄒: '邹', 閆: '闫', 龍: '龙', 賀: '贺',
  顧: '顾', 龔: '龚', 萬: '万', 錢: '钱', 嚴: '严', 湯: '汤', 晉: '晋', 塗: '涂',
}
function normalizeSurname(s: string): string {
  let out = s.trim()
  for (const [trad, simp] of TRAD_COMPOUND) out = out.split(trad).join(simp)
  return [...out].map((ch) => TRAD_SINGLE[ch] ?? ch).join('')
}

export default function Auth({ onSuccess }: { onSuccess: (user: User) => void }) {
  // const [tab, setTab] = useState<Tab>('login') // v1.5 隐藏 tab 切换
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /* login */
  const [loginPid, setLoginPid] = useState('')
  const [loginPidConfirm, setLoginPidConfirm] = useState('')
  const [loginSurname, setLoginSurname] = useState('')

  /* v1.5 隐藏注册：注册表单状态保留，便于将来恢复
  const [participantId, setParticipantId] = useState('')
  const [parentSurname, setParentSurname] = useState('')
  const [childName, setChildName] = useState('')
  const [childGender, setChildGender] = useState('')
  const [email, setEmail] = useState('')

  const switchTab = (next: Tab) => {
    setTab(next)
    setError('')
  }
  */

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    const pid = loginPid.trim()
    if (!/^\d{4}$/.test(pid)) {
      setError('被試編號為 4 位數字，如 0101')
      return
    }
    if (pid !== loginPidConfirm.trim()) {
      setError('兩次輸入的編號不一致')
      return
    }
    const surname = normalizeSurname(loginSurname)
    if (!surname) {
      setError('請輸入兒童姓氏')
      return
    }
    setBusy(true)
    setError('')
    const r = await loginUser(pid + surname)
    setBusy(false)
    if (r.ok) onSuccess(r.user)
    else setError(r.error)
  }

  /* v1.5 隐藏注册：注册提交逻辑保留，便于将来恢复
  const handleRegister = async (e: FormEvent) => {
    e.preventDefault()
    const pid = participantId.trim()
    if (!/^\d{4}$/.test(pid)) {
      setError('被试编号为 4 位数字，如 0101')
      return
    }
    if (!parentSurname.trim()) {
      setError('请输入家长姓氏')
      return
    }
    if (!childName.trim()) {
      setError('请输入小孩姓名')
      return
    }
    if (!childGender) {
      setError('请选择小孩性别')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('请输入正确的邮箱地址')
      return
    }
    setBusy(true)
    setError('')
    const r = await registerUser({
      participantId: pid,
      parentSurname: parentSurname.trim(),
      childName: childName.trim(),
      childGender,
      email: email.trim(),
    })
    setBusy(false)
    if (r.ok) onSuccess(r.user)
    else setError(r.error)
  }
  */

  return (
    <div className="veil veil-in-fast">
      <div className="intro-card auth-card">
        <h1 className="intro-title">小遊戲時間</h1>
        <p className="intro-sub">請使用研究人員提供的編號登錄</p>

        {/* v1.5 隐藏「登录 / 注册」tab 切换，仅保留登录表单；恢复注册时取消注释
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            className={tab === 'login' ? 'auth-tab auth-tab-on' : 'auth-tab'}
            onClick={() => switchTab('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            className={tab === 'register' ? 'auth-tab auth-tab-on' : 'auth-tab'}
            onClick={() => switchTab('register')}
          >
            注册
          </button>
        </div>
        */}

        <form className="auth-form" onSubmit={handleLogin}>
            <label className="auth-label" htmlFor="auth-login-pid">
              被試編號
            </label>
            <input
              id="auth-login-pid"
              className="auth-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="4 位數字，如 0101"
              value={loginPid}
              onChange={(e) => setLoginPid(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />

            <label className="auth-label" htmlFor="auth-login-pid-confirm">
              再次輸入被試編號
            </label>
            <input
              id="auth-login-pid-confirm"
              className="auth-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="再輸入一遍，防止輸錯"
              value={loginPidConfirm}
              onChange={(e) => setLoginPidConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />

            <label className="auth-label" htmlFor="auth-login-surname">
              兒童姓氏
            </label>
            <input
              id="auth-login-surname"
              className="auth-input"
              type="text"
              autoComplete="off"
              placeholder="如：張"
              value={loginSurname}
              onChange={(e) => setLoginSurname(e.target.value)}
            />

            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="mode-btn mode-play auth-submit" disabled={busy}>
              <span>{busy ? '登錄中…' : '登錄'}</span>
            </button>
          </form>

        {/* v1.5 隐藏注册表单：JSX 保留但不渲染，便于将来恢复
        <form className="auth-form" onSubmit={handleRegister}>
            <label className="auth-label" htmlFor="auth-pid">
              被试编号
            </label>
            <input
              id="auth-pid"
              className="auth-input"
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="4 位数字，如 0101"
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />

            <label className="auth-label" htmlFor="auth-surname">
              家长姓氏
            </label>
            <input
              id="auth-surname"
              className="auth-input"
              type="text"
              placeholder="如：赵"
              value={parentSurname}
              onChange={(e) => setParentSurname(e.target.value)}
            />

            <label className="auth-label" htmlFor="auth-child">
              小孩姓名
            </label>
            <input
              id="auth-child"
              className="auth-input"
              type="text"
              placeholder="孩子的大名或小名"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />

            <span className="auth-label">小孩性别</span>
            <div className="auth-gender" role="radiogroup" aria-label="小孩性别">
              {['男', '女'].map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={childGender === g}
                  className={childGender === g ? 'auth-gender-btn auth-gender-on' : 'auth-gender-btn'}
                  onClick={() => setChildGender(g)}
                >
                  {g}
                </button>
              ))}
            </div>

            <label className="auth-label" htmlFor="auth-email">
              邮箱
            </label>
            <input
              id="auth-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              placeholder="用于接收实验相关通知"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="mode-btn mode-watch auth-submit" disabled={busy}>
              <span>{busy ? '注册中…' : '注册并登录'}</span>
            </button>
          </form>
        */}

        <p className="intro-hint auth-hint">
          編號由研究人員提供；登錄信息僅保存在這台設備上，請放心填寫
        </p>
      </div>
    </div>
  )
}
