import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  Activity, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Copy,
  FileCheck2, FilePlus2, FileText, Fingerprint, GitBranch, History,
  LayoutDashboard, Link2, List, LockKeyhole, Menu, Moon, Network, Plus,
  Shield, ShieldCheck, Sun, Upload, Wallet, X,
} from 'lucide-react'
import { Contract } from 'ethers'
import { canUseLocalDemoAccount, connectWallet, contractAddress, humanError, readContract, registryAbi, sha256, shorten } from './chain'

type Tab = 'overview' | 'register' | 'verify' | 'activity'
type VersionRecord = { hash: string; writer: string; parentHash: string; title: string; registeredAt: number; tx: string }
type ChainVersion = { writer: string; registeredAt: bigint; parentHash: string; title: string; exists: boolean }
type Theme = 'cherry' | 'dark'

const navigation: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'register', label: 'Register a version', icon: FilePlus2 },
  { id: 'verify', label: 'Verify a file', icon: FileCheck2 },
  { id: 'activity', label: 'Activity', icon: History },
]

function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('inkchain-theme') === 'dark' ? 'dark' : 'cherry')
  const [selectedRecord, setSelectedRecord] = useState<VersionRecord | null>(null)
  const [account, setAccount] = useState('')
  const [chainId, setChainId] = useState<bigint | null>(null)
  const [toast, setToast] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [records, setRecords] = useState<VersionRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('inkchain-records') || '[]') as VersionRecord[] } catch { return [] }
  })
  const [file, setFile] = useState<File | null>(null)
  const [parentHash, setParentHash] = useState('')
  const [title, setTitle] = useState('')
  const [hash, setHash] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verifyResult, setVerifyResult] = useState<ChainVersion | null>(null)
  const [verifyHash, setVerifyHash] = useState('')
  const [verifyFileName, setVerifyFileName] = useState('')
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [contractOk, setContractOk] = useState(false)

  const activeLabel = navigation.find((item) => item.id === tab)?.label ?? 'Overview'
  const initials = account ? account.slice(2, 4).toUpperCase() : ''

  useEffect(() => {
    let mounted = true
    try {
      readContract().getVersion(`0x${'00'.repeat(32)}`)
        .then(() => { if (mounted) setContractOk(true) })
        .catch(() => { if (mounted) setContractOk(false) })
    } catch { setContractOk(false) }
    return () => { mounted = false }
  }, [])

  useEffect(() => { localStorage.setItem('inkchain-records', JSON.stringify(records)) }, [records])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('inkchain-theme', theme)
  }, [theme])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (!selectedRecord) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedRecord(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedRecord])

  const switchTab = (next: Tab) => { setTab(next); setMobileMenu(false) }
  const handleConnect = async () => {
    try {
      const wallet = await connectWallet()
      setAccount(wallet.address)
      setChainId(wallet.chainId)
      setToast('Wallet connected')
    } catch (error) { setToast(humanError(error)) }
  }

  const chooseFile = async (next: File | undefined, mode: 'register' | 'verify') => {
    if (!next) return
    if (next.size > 50 * 1024 * 1024) { setToast('Choose a file smaller than 50 MB.'); return }
    if (mode === 'register') {
      setFile(next)
      setTitle((current) => current || next.name.replace(/\.[^/.]+$/, ''))
      setHash('')
    } else {
      setVerifyFileName(next.name)
      setVerifyResult(null)
      setVerifyHash('')
    }
    try {
      const digest = await sha256(next)
      if (mode === 'register') setHash(digest)
      else setVerifyHash(digest)
    } catch { setToast('This browser could not read the selected file.') }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>, mode: 'register' | 'verify') => {
    event.preventDefault()
    setIsDragging(false)
    void chooseFile(event.dataTransfer.files[0], mode)
  }

  const registerVersion = async () => {
    if (!file || !hash) { setToast('Choose a manuscript file first.'); return }
    if (!title.trim()) { setToast('Add a version label first.'); return }
    if (!account) { await handleConnect(); return }
    if (!contractAddress) { setToast('Registry is not configured. Follow the local setup in README.'); return }
    setBusy(true)
    try {
      const wallet = await connectWallet()
      setAccount(wallet.address)
      setChainId(wallet.chainId)
      const parent = parentHash.trim() || `0x${'00'.repeat(32)}`
      const registry = new Contract(contractAddress, registryAbi, wallet.signer)
      const transaction = await registry.registerVersion(hash, parent, title.trim())
      setToast('Transaction submitted. Waiting for confirmation…')
      const receipt = await transaction.wait()
      const next: VersionRecord = {
        hash, writer: wallet.address, parentHash: parent, title: title.trim(),
        registeredAt: Math.floor(Date.now() / 1000), tx: receipt.hash,
      }
      setRecords((previous) => [next, ...previous.filter((item) => item.hash !== hash)])
      setToast('Version registered on-chain')
      setFile(null); setHash(''); setParentHash(''); setTitle('')
    } catch (error) { setToast(humanError(error)) }
    finally { setBusy(false) }
  }

  const verifyManuscript = async () => {
    if (!verifyHash) { setToast('Choose a manuscript file first.'); return }
    setVerifyBusy(true)
    setVerifyResult(null)
    try {
      const result = await readContract().getVersion(verifyHash) as [string, bigint, string, string, boolean]
      setVerifyResult(result[4]
        ? { writer: result[0], registeredAt: result[1], parentHash: result[2], title: result[3], exists: true }
        : { writer: '', registeredAt: 0n, parentHash: '', title: '', exists: false })
    } catch (error) { setToast(humanError(error)) }
    finally { setVerifyBusy(false) }
  }

  const copyHash = async (value: string) => {
    await navigator.clipboard.writeText(value)
    setToast('Hash copied')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <a className="brand" onClick={() => switchTab('overview')}>
          <span className="brand-mark"><BookOpen size={17} /></span><span>inkchain</span>
        </a>
        <div className="workspace-label"><span className="workspace-avatar">W</span><span>Personal workspace</span><ChevronDown size={13} /></div>
        <span className="nav-label">WORKSPACE</span>
        <nav className="primary-nav">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => switchTab(id)} className={`nav-item ${tab === id ? 'nav-active' : ''}`}>
              <Icon size={16} strokeWidth={1.8} /><span>{label}</span>
              {id === 'activity' && records.length > 0 && <span className="nav-count">{records.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note"><LockKeyhole size={14} /><span>Manuscripts stay on your device.</span></div>
        <div className="sidebar-bottom"><span className={`status-dot ${contractOk ? 'status-live' : ''}`} /><span>{contractOk ? 'Registry connected' : 'Registry offline'}</span><span className="version-label">v0.1</span></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu-button" aria-label="Toggle menu" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={19} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeLabel}</strong></div>
          <div className="top-actions">
            <div className="theme-switch" role="group" aria-label="Choose theme">
              <button className={theme === 'cherry' ? 'theme-selected' : ''} aria-label="Light theme" aria-pressed={theme === 'cherry'} onClick={() => setTheme('cherry')}><Sun size={14} /></button>
              <button className={theme === 'dark' ? 'theme-selected' : ''} aria-label="Dark theme" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={14} /></button>
            </div>
            {chainId !== null && <span className="network-pill"><span className="status-dot status-live" />{chainId === 31337n ? 'Hardhat local' : `Chain ${chainId.toString()}`}</span>}
            <button className={`wallet-button ${account ? 'wallet-connected' : ''}`} onClick={handleConnect}>
              <Wallet size={14} />{account ? <><span className="wallet-identicon">{initials}</span>{shorten(account)}</> : canUseLocalDemoAccount ? 'Use demo account' : 'Connect wallet'}
            </button>
          </div>
        </header>

        <div className="page-content">
          {tab === 'overview' && <Overview records={records} onNavigate={switchTab} contractOk={contractOk} onSelect={setSelectedRecord} />}
          {tab === 'register' && <RegisterPage file={file} hash={hash} parentHash={parentHash} title={title} busy={busy} isDragging={isDragging} setParentHash={setParentHash} setTitle={setTitle} setIsDragging={setIsDragging} onDrop={onDrop} onFile={(event) => void chooseFile(event.target.files?.[0], 'register')} onRegister={() => void registerVersion()} onCopy={() => void copyHash(hash)} />}
          {tab === 'verify' && <VerifyPage fileName={verifyFileName} hash={verifyHash} result={verifyResult} busy={verifyBusy} isDragging={isDragging} setIsDragging={setIsDragging} onDrop={onDrop} onFile={(event) => void chooseFile(event.target.files?.[0], 'verify')} onVerify={() => void verifyManuscript()} onCopy={() => void copyHash(verifyHash)} />}
          {tab === 'activity' && <ActivityPage records={records} onSelect={setSelectedRecord} />}
        </div>
      </main>
      {mobileMenu && <button aria-label="Close menu" className="mobile-scrim" onClick={() => setMobileMenu(false)} />}
      {toast && <div className="toast"><span className="toast-icon"><Check size={15} /></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={14} /></button></div>}
      {selectedRecord && <VersionDetails record={selectedRecord} onClose={() => setSelectedRecord(null)} onCopy={(value) => void copyHash(value)} />}
    </div>
  )
}

function Overview({ records, onNavigate, contractOk, onSelect }: {
  records: VersionRecord[]; onNavigate: (tab: Tab) => void; contractOk: boolean
  onSelect: (record: VersionRecord) => void
}) {
  const [versionView, setVersionView] = useState<'recent' | 'all'>('recent')
  const visibleRecords = versionView === 'recent' ? records.slice(0, 3) : records
  return <>
    <section className="overview-hero">
      <HeroDoodle />
      <div className="eyebrow">MANUSCRIPT PROVENANCE</div>
      <h1>Keep a record of your work.</h1>
      <p className="page-subtitle">A verifiable history for every version, while your pages stay private.</p>
      <button className="button button-primary" onClick={() => onNavigate('register')}><Plus size={15} />New version</button>
    </section>
    {!contractOk && <div className="setup-note"><Network size={15} /><span>Registry offline. Start the local chain and deploy the contract to enable on-chain actions.</span></div>}
    <section className="section-block">
      <div className="section-heading"><div><h2>{versionView === 'recent' ? 'Recent versions' : 'All versions'}</h2><p>Saved in this browser</p></div>
        <div className="version-view-switch" role="group" aria-label="Version list range">
          <button className={versionView === 'recent' ? 'view-selected' : ''} aria-pressed={versionView === 'recent'} onClick={() => setVersionView('recent')}>Recent</button>
          <button className={versionView === 'all' ? 'view-selected' : ''} aria-pressed={versionView === 'all'} onClick={() => setVersionView('all')}>All versions</button>
        </div>
      </div>
      <div className="table-card">
        {visibleRecords.length ? <div className="records-list">{visibleRecords.map((item) => <button className="record-row" key={item.hash} onClick={() => onSelect(item)}>
          <span className="record-file-icon"><FileText size={16} /></span><span className="record-main"><strong>{item.title}</strong><span>{shorten(item.hash, 10)}</span></span>
          <span className="record-status"><span className="verified-dot" />Registered</span><span className="record-date">{new Date(item.registeredAt * 1000).toLocaleDateString()}</span><ArrowRight size={14} className="record-arrow" />
        </button>)}</div> : <div className="empty-state"><span className="empty-file"><FileText size={20} /></span><strong>No versions yet</strong><p>Your first registration will appear here.</p></div>}
      </div>
    </section>
    <p className="quiet-note"><LockKeyhole size={13} />The file is hashed in your browser. Only its fingerprint is recorded.</p>
  </>
}

function HeroDoodle() {
  return <svg className="hero-doodle" viewBox="0 0 220 132" fill="none" aria-hidden="true">
    <path d="M52 38c18-6 39-3 55 8 16-11 37-14 56-8v61c-20-6-40-3-56 8-16-11-37-14-55-8V38Z" />
    <path d="M107 47v58M63 51c10-2 20 0 29 4M63 62c10-2 20 0 29 4M63 73c8-1 16 0 23 3M130 55c10-4 20-6 30-4M130 66c10-4 20-6 30-4M130 77c8-3 15-4 23-3" />
    <path d="M43 27c11-9 24-13 37-14M177 22l5-9 5 9 9 5-9 5-5 9-5-9-9-5 9-5Z" />
    <path d="M39 92c-7 4-11 10-13 18M183 93c7 4 11 10 13 18" />
    <circle cx="34" cy="62" r="2" /><circle cx="190" cy="61" r="2" /><circle cx="74" cy="116" r="2" /><circle cx="148" cy="117" r="2" />
  </svg>
}

function Dropzone({ mode, fileName, dragging, setDragging, onDrop, onFile }: {
  mode: 'register' | 'verify'; fileName: string; dragging: boolean; setDragging: (value: boolean) => void
  onDrop: (event: DragEvent<HTMLDivElement>, mode: 'register' | 'verify') => void
  onFile: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return <div className={`dropzone ${dragging ? 'dropzone-active' : ''} ${fileName ? 'dropzone-has-file' : ''}`}
    onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => onDrop(event, mode)}>
    <input type="file" onChange={onFile} aria-label="Choose manuscript file" />
    <span className="upload-icon">{fileName ? <FileCheck2 size={19} /> : <Upload size={19} />}</span>
    <strong>{fileName || 'Choose a file or drop it here'}</strong>
    <small>Any file type · up to 50 MB</small>
  </div>
}

function RegisterPage(props: {
  file: File | null; hash: string; parentHash: string; title: string; busy: boolean; isDragging: boolean
  setParentHash: (value: string) => void; setTitle: (value: string) => void; setIsDragging: (value: boolean) => void
  onDrop: (event: DragEvent<HTMLDivElement>, mode: 'register' | 'verify') => void
  onFile: (event: ChangeEvent<HTMLInputElement>) => void; onRegister: () => void; onCopy: () => void
}) {
  return <>
    <div className="page-title-row"><div><div className="eyebrow">NEW RECORD</div><h1>Register a version</h1><p className="page-subtitle">Create a dated proof for a manuscript.</p></div></div>
    <div className="editor-layout">
      <section className="form-card editor-card">
        <label className="field-label" htmlFor="manuscript-file">Manuscript</label>
        <div id="manuscript-file"><Dropzone mode="register" fileName={props.file?.name ?? ''} dragging={props.isDragging} setDragging={props.setIsDragging} onDrop={props.onDrop} onFile={props.onFile} /></div>
        {props.file && <div className="file-meta"><FileText size={15} /><span>{props.file.name}</span><small>{(props.file.size / 1024).toFixed(1)} KB</small></div>}
        <div className="editor-divider" />
        <label className="field-label" htmlFor="version-title">Version name</label>
        <input id="version-title" className="text-input" maxLength={120} placeholder="e.g. First draft" value={props.title} onChange={(event) => props.setTitle(event.target.value)} />
        <label className="field-label parent-label" htmlFor="parent-hash">Previous version <span>Optional</span></label>
        <input id="parent-hash" className="text-input mono-input" placeholder="Paste a registered hash to link versions" value={props.parentHash} onChange={(event) => props.setParentHash(event.target.value)} />
        <p className="field-hint"><Link2 size={13} />Leave blank for a first version.</p>
      </section>
      <aside className="proof-aside">
        <div className="proof-preview"><div className="preview-heading"><Fingerprint size={16} /><span>FINGERPRINT</span><span className="algorithm-label">SHA-256</span></div>
          <code className="preview-hash">{props.hash || 'Select a file to generate its hash'}</code>
          {props.hash && <button className="copy-button" onClick={props.onCopy}><Copy size={13} />Copy hash</button>}
        </div>
        <button className="button button-primary submit-button" disabled={props.busy || !props.hash || !props.title.trim()} onClick={props.onRegister}>
          {props.busy ? <><span className="spinner" />Registering…</> : <>Continue to wallet <ArrowRight size={15} /></>}
        </button>
        <p className="aside-note"><ShieldCheck size={13} />The manuscript stays on this device.</p>
      </aside>
    </div>
  </>
}

function VerifyPage(props: {
  fileName: string; hash: string; result: ChainVersion | null; busy: boolean; isDragging: boolean
  setIsDragging: (value: boolean) => void; onDrop: (event: DragEvent<HTMLDivElement>, mode: 'register' | 'verify') => void
  onFile: (event: ChangeEvent<HTMLInputElement>) => void; onVerify: () => void; onCopy: () => void
}) {
  return <>
    <div className="page-title-row"><div><div className="eyebrow">CHECK A RECORD</div><h1>Verify a file</h1><p className="page-subtitle">Compare a manuscript’s fingerprint with the registry.</p></div></div>
    <div className="verify-wrap">
      <div className="form-card verify-card">
        <label className="field-label">Manuscript</label>
        <Dropzone mode="verify" fileName={props.fileName} dragging={props.isDragging} setDragging={props.setIsDragging} onDrop={props.onDrop} onFile={props.onFile} />
        {props.hash && <div className="hash-result"><code>{props.hash}</code><button className="copy-button" onClick={props.onCopy}><Copy size={13} />Copy</button></div>}
        <button className="button button-primary verify-submit" disabled={props.busy || !props.hash} onClick={props.onVerify}>
          {props.busy ? <><span className="spinner" />Checking…</> : <>Check registry <ArrowRight size={15} /></>}
        </button>
      </div>
      {props.result && <div className={`verification-result ${props.result.exists ? 'result-match' : 'result-miss'}`}>
        <span className="result-icon">{props.result.exists ? <CheckCircle2 size={20} /> : <X size={20} />}</span>
        <div><strong>{props.result.exists ? 'Matching record found' : 'No matching record'}</strong>
          <p>{props.result.exists ? 'This exact file fingerprint is registered.' : 'This fingerprint is not present in the configured registry.'}</p>
          {props.result.exists && <div className="result-details"><span><small>Version</small><strong>{props.result.title}</strong></span><span><small>Wallet</small><strong>{shorten(props.result.writer)}</strong></span><span><small>Registered</small><strong>{new Date(Number(props.result.registeredAt) * 1000).toLocaleString()}</strong></span></div>}
        </div>
      </div>}
      <p className="quiet-note"><LockKeyhole size={13} />The file is checked locally; its contents are never uploaded.</p>
    </div>
  </>
}

function buildVersionPaths(records: VersionRecord[]) {
  const byHash = new Map(records.map((record) => [record.hash.toLowerCase(), record]))
  const children = new Map<string, VersionRecord[]>()
  for (const record of records) {
    const parent = record.parentHash.toLowerCase()
    if (!byHash.has(parent)) continue
    children.set(parent, [...(children.get(parent) ?? []), record])
  }
  for (const group of children.values()) group.sort((a, b) => a.registeredAt - b.registeredAt)

  const roots = records.filter((record) => !byHash.has(record.parentHash.toLowerCase()))
    .sort((a, b) => a.registeredAt - b.registeredAt)
  const visited = new Set<string>()
  const paths: VersionRecord[][] = []
  const walk = (record: VersionRecord, path: VersionRecord[], active: Set<string>) => {
    const key = record.hash.toLowerCase()
    if (active.has(key)) { paths.push([...path, record]); return }
    const nextPath = [...path, record]
    visited.add(key)
    const nextActive = new Set(active).add(key)
    const nextVersions = children.get(key) ?? []
    if (nextVersions.length === 0) paths.push(nextPath)
    else nextVersions.forEach((next) => walk(next, nextPath, nextActive))
  }
  roots.forEach((root) => { if (!visited.has(root.hash.toLowerCase())) walk(root, [], new Set()) })
  records.forEach((record) => { if (!visited.has(record.hash.toLowerCase())) walk(record, [], new Set()) })
  return paths
}

function ActivityPage({ records, onSelect }: { records: VersionRecord[]; onSelect: (record: VersionRecord) => void }) {
  const [view, setView] = useState<'table' | 'graph'>('table')
  const orderedRecords = [...records].sort((a, b) => b.registeredAt - a.registeredAt)
  const paths = buildVersionPaths(records)
  return <>
    <div className="page-title-row activity-title-row">
      <div><div className="eyebrow">YOUR RECORDS</div><h1>Activity</h1><p className="page-subtitle">Versions registered from this browser.</p></div>
      <div className="activity-controls"><span className="activity-total">{records.length}</span>
        <div className="view-switch" role="group" aria-label="Activity view">
          <button className={view === 'table' ? 'view-selected' : ''} aria-label="Table view" aria-pressed={view === 'table'} onClick={() => setView('table')}><List size={15} /></button>
          <button className={view === 'graph' ? 'view-selected' : ''} aria-label="Graph view" aria-pressed={view === 'graph'} onClick={() => setView('graph')}><GitBranch size={15} /></button>
        </div>
      </div>
    </div>
    {records.length === 0 ? <div className="table-card"><div className="empty-state"><span className="empty-file"><History size={19} /></span><strong>Nothing here yet</strong><p>Registered versions will appear here.</p></div></div>
      : view === 'table' ? <div className="table-card activity-table">
        <div className="activity-table-head"><span>VERSION</span><span>FINGERPRINT</span><span>DATE</span><span>WALLET</span></div>
        {orderedRecords.map((record) => <button className="activity-table-row" key={record.hash} onClick={() => onSelect(record)}>
          <span className="activity-title"><FileText size={15} /><strong>{record.title}</strong></span>
          <span className="activity-hash mono">{shorten(record.hash, 8)}</span>
          <span className="activity-date">{new Date(record.registeredAt * 1000).toLocaleDateString()}</span><span className="activity-wallet mono">{shorten(record.writer)}</span>
        </button>)}
      </div> : <div className="graph-view">
        <p className="graph-caption">Connected versions follow their previous-version fingerprint.</p>
        {paths.map((path, pathIndex) => <div className="graph-lane" key={`${path[0]?.hash ?? 'empty'}-${pathIndex}`}>
          <span className="graph-lane-label">{paths.length > 1 ? `PATH ${pathIndex + 1}` : 'VERSION HISTORY'}</span>
          <div className="graph-track">{path.map((record, index) => <span className="graph-step" key={record.hash}>
            <button className="graph-card" onClick={() => onSelect(record)}>
              <span className="graph-card-top"><FileText size={14} /><span>{new Date(record.registeredAt * 1000).toLocaleDateString()}</span></span>
              <strong>{record.title}</strong><code>{shorten(record.hash, 7)}</code>
            </button>
            {index < path.length - 1 && <span className="graph-arrow"><ArrowRight size={17} /></span>}
          </span>)}</div>
        </div>)}
      </div>}
    <p className="activity-footnote"><Shield size={13} />The blockchain remains the source of truth for verification.</p>
  </>
}

function VersionDetails({ record, onClose, onCopy }: { record: VersionRecord; onClose: () => void; onCopy: (value: string) => void }) {
  const zeroHash = `0x${'00'.repeat(32)}`
  return <div className="modal-layer" onClick={onClose}>
    <section className="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-modal-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-heading"><div><span className="eyebrow">VERSION RECORD</span><h2 id="version-modal-title">{record.title}</h2></div><button className="modal-close" aria-label="Close version details" onClick={onClose}><X size={17} /></button></div>
      <dl className="version-details-list">
        <div><dt>Registered</dt><dd>{new Date(record.registeredAt * 1000).toLocaleString()}</dd></div>
        <div><dt>Wallet</dt><dd className="mono">{record.writer}</dd></div>
        <div><dt>Previous version</dt><dd className="mono">{record.parentHash.toLowerCase() === zeroHash ? 'First version' : record.parentHash}</dd></div>
        <div><dt>Transaction</dt><dd className="mono">{record.tx}</dd></div>
      </dl>
      <div className="modal-hash"><span>SHA-256 fingerprint</span><code>{record.hash}</code></div>
      <button className="button button-primary modal-copy" onClick={() => onCopy(record.hash)}><Copy size={14} />Copy fingerprint</button>
    </section>
  </div>
}

export default App
