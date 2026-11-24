import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  Activity, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Copy,
  FileCheck2, FilePlus2, FileText, Fingerprint, GitBranch, History,
  LayoutDashboard, Link2, List, LockKeyhole, Menu, Moon, Network, Plus,
  Shield, ShieldCheck, Sun, Upload, Wallet, X,
} from 'lucide-react'
import { Contract, hexlify, randomBytes } from 'ethers'
import { assertWalletNetwork, canUseLocalDemoAccount, configuredChainId, connectWallet, contractAddress, humanError, readContract, readProvider, registryAbi, registryDeploymentBlock, sha256, shorten } from './chain'

type Tab = 'overview' | 'register' | 'verify' | 'activity'
type VersionRecord = {
  hash: string; writer: string; parentHash: string; title: string; registeredAt: number; tx: string
  manuscriptId: string; manuscriptTitle: string; changeNote: string; fileType: string; fileSize: number
  chainId: string; contractAddress: string; blockNumber: number; blockHash: string; privacyMode?: 'public' | 'local'; legacy?: boolean
}
type ChainVersion = {
  manuscriptId: string; parentHash: string; writer: string; registeredAt: bigint; fileSize: bigint
  manuscriptTitle: string; title: string; changeNote: string; fileType: string; exists: boolean
}
type AttestationRole = 'editor' | 'publisher'
type ChainAttestation = { signer: string; role: number; attestedAt: bigint }
type Theme = 'cherry' | 'dark'

const zeroHash = `0x${'00'.repeat(32)}`
const privateManuscriptLabel = 'Private manuscript'
const privateVersionLabel = 'Version'
type PrivateDescription = { manuscriptTitle: string; title: string; changeNote: string }

function getFileType(file: File) {
  if (file.type) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  const knownTypes: Record<string, string> = { txt: 'text/plain', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', md: 'text/markdown' }
  return extension ? knownTypes[extension] ?? `.${extension}` : 'application/octet-stream'
}

function loadRecords(): VersionRecord[] {
  try {
    const rows = JSON.parse(localStorage.getItem('inkchain-records') || '[]') as Partial<VersionRecord>[]
    return rows.map((row) => ({
      hash: row.hash ?? '', writer: row.writer ?? '', parentHash: row.parentHash ?? zeroHash,
      title: row.title ?? 'Version', registeredAt: Number(row.registeredAt ?? 0), tx: row.tx ?? '',
      manuscriptId: row.manuscriptId ?? '', manuscriptTitle: row.manuscriptTitle ?? row.title ?? 'Manuscript',
      changeNote: row.changeNote ?? '', fileType: row.fileType ?? 'Unknown', fileSize: Number(row.fileSize ?? 0),
      chainId: row.chainId ?? '', contractAddress: row.contractAddress ?? '',
      blockNumber: Number(row.blockNumber ?? 0), blockHash: row.blockHash ?? '', privacyMode: row.privacyMode,
      legacy: row.legacy ?? !row.manuscriptId,
    })).filter((row) => row.hash && row.writer)
  } catch { return [] }
}

function loadPrivateDescriptions() {
  const descriptions = new Map<string, PrivateDescription>()
  try {
    const stored = JSON.parse(localStorage.getItem('inkchain-private-descriptions') || '{}') as Record<string, PrivateDescription>
    Object.entries(stored).forEach(([hash, description]) => descriptions.set(hash.toLowerCase(), description))
  } catch { /* Ignore malformed optional local metadata. */ }
  loadRecords().filter((record) => record.privacyMode === 'local').forEach((record) => {
    if (!descriptions.has(record.hash.toLowerCase())) {
      descriptions.set(record.hash.toLowerCase(), { manuscriptTitle: record.manuscriptTitle, title: record.title, changeNote: record.changeNote })
    }
  })
  return descriptions
}

function savePrivateDescription(hash: string, description: PrivateDescription) {
  const descriptions = loadPrivateDescriptions()
  descriptions.set(hash.toLowerCase(), description)
  try {
    localStorage.setItem('inkchain-private-descriptions', JSON.stringify(Object.fromEntries(descriptions)))
    return true
  } catch { return false }
}

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
  const [records, setRecords] = useState<VersionRecord[]>(loadRecords)
  const [file, setFile] = useState<File | null>(null)
  const [parentHash, setParentHash] = useState('')
  const [linkedManuscriptId, setLinkedManuscriptId] = useState('')
  const [manuscriptTitle, setManuscriptTitle] = useState('')
  const [title, setTitle] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [privacyMode, setPrivacyMode] = useState<'public' | 'local'>('public')
  const [hash, setHash] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verifyResult, setVerifyResult] = useState<ChainVersion | null>(null)
  const [verifyHash, setVerifyHash] = useState('')
  const [verifyFileName, setVerifyFileName] = useState('')
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [contractOk, setContractOk] = useState(false)
  const [registryIssue, setRegistryIssue] = useState('Checking registry connection…')

  const activeLabel = navigation.find((item) => item.id === tab)?.label ?? 'Overview'
  const initials = account ? account.slice(2, 4).toUpperCase() : ''

  useEffect(() => {
    let mounted = true
    let syncing = false
    const syncRegistry = async () => {
      if (syncing) return
      syncing = true
      try {
        const registry = readContract()
        const provider = readProvider()
        const [network, latestBlock] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()])
        if (configuredChainId !== null && network.chainId !== configuredChainId) {
          throw new Error(`Registry RPC is on chain ${network.chainId}; expected chain ${configuredChainId}.`)
        }
        const code = await provider.getCode(String(registry.target))
        if (code === '0x') {
          throw new Error(`No registry contract is deployed at ${registry.target} on chain ${network.chainId}. Start the chain and deploy ManuscriptRegistry.`)
        }
        await registry.getVersion(zeroHash)
        const filter = registry.filters.VersionRegistered()
        const events = []
        const privateDescriptions = loadPrivateDescriptions()
        for (let fromBlock = registryDeploymentBlock; fromBlock <= latestBlock; fromBlock += 2_000) {
          const toBlock = Math.min(fromBlock + 1_999, latestBlock)
          events.push(...await registry.queryFilter(filter, fromBlock, toBlock))
        }
        const chainRecords: VersionRecord[] = events.flatMap((event) => {
          if (!('args' in event)) return []
          const args = event.args as unknown as Record<string, unknown> & unknown[]
          const value = (name: string, index: number) => args[name] ?? args[index]
          const hash = String(value('versionId', 0))
          const cached = privateDescriptions.get(hash.toLowerCase())
          const isPrivate = value('manuscriptTitle', 6) === privateManuscriptLabel && value('versionLabel', 7) === privateVersionLabel
          const localPrivacyMode: VersionRecord['privacyMode'] = isPrivate ? 'local' : 'public'
          return [{
            hash, manuscriptId: String(value('manuscriptId', 1)),
            parentHash: String(value('parentVersionId', 2)), writer: String(value('writer', 3)),
            registeredAt: Number(value('registeredAt', 4)), fileSize: Number(value('fileSize', 5)),
            manuscriptTitle: isPrivate ? cached?.manuscriptTitle ?? privateManuscriptLabel : String(value('manuscriptTitle', 6)),
            title: isPrivate ? cached?.title ?? privateVersionLabel : String(value('versionLabel', 7)),
            changeNote: isPrivate ? cached?.changeNote ?? '' : String(value('changeNote', 8)),
            privacyMode: localPrivacyMode, fileType: String(value('fileType', 9)),
            tx: event.transactionHash, chainId: network.chainId.toString(),
            contractAddress: String(registry.target), blockNumber: event.blockNumber,
            blockHash: event.blockHash, legacy: false,
          }]
        }).sort((a, b) => b.registeredAt - a.registeredAt)
        if (mounted) {
          setRecords(chainRecords)
          setContractOk(true)
          setRegistryIssue('')
        }
      } catch (error) {
        if (mounted) {
          setContractOk(false)
          setRegistryIssue(humanError(error))
        }
      } finally { syncing = false }
    }
    void syncRegistry()
    const interval = window.setInterval(() => void syncRegistry(), 15_000)
    return () => { mounted = false; window.clearInterval(interval) }
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

  const resolveParentVersion = async (value = parentHash.trim()) => {
    if (!value) { setLinkedManuscriptId(''); return }
    try {
      const result = await readContract().getVersion(value) as [string, string, string, bigint, bigint, string, string, string, string, boolean]
      if (!result[9]) throw new Error('No registered version has that fingerprint.')
      setLinkedManuscriptId(result[0])
      const cached = loadPrivateDescriptions().get(value.toLowerCase())
      const privateParent = result[5] === privateManuscriptLabel
      setPrivacyMode(privateParent ? 'local' : 'public')
      setManuscriptTitle(privateParent ? cached?.manuscriptTitle ?? '' : result[5])
    } catch (error) {
      setLinkedManuscriptId('')
      setToast(humanError(error))
    }
  }

  const registerVersion = async () => {
    if (!file || !hash) { setToast('Choose a manuscript file first.'); return }
    if (!manuscriptTitle.trim()) { setToast('Add a manuscript title first.'); return }
    if (!title.trim()) { setToast('Add a version label first.'); return }
    if (!account) { await handleConnect(); return }
    if (!contractAddress) { setToast('Registry is not configured. Follow the local setup in README.'); return }
    setBusy(true)
    try {
      const wallet = await connectWallet()
      await assertWalletNetwork(wallet.chainId)
      setAccount(wallet.address)
      setChainId(wallet.chainId)
      const parent = parentHash.trim() || zeroHash
      let manuscriptId = linkedManuscriptId
      if (parent !== zeroHash) {
        const parentRecord = await readContract().getVersion(parent) as [string, string, string, bigint, bigint, string, string, string, string, boolean]
        if (!parentRecord[9]) throw new Error('Previous version fingerprint was not found in this registry.')
        manuscriptId = parentRecord[0]
        const privateParent = parentRecord[5] === privateManuscriptLabel
        if (privateParent && privacyMode !== 'local') throw new Error('This history keeps descriptive details private. Choose “Keep details in this browser” for this version too.')
        if (!privateParent && manuscriptTitle.trim() !== parentRecord[5]) throw new Error(`Use the existing manuscript title: ${parentRecord[5]}`)
      } else {
        manuscriptId = hexlify(randomBytes(32))
      }
      const registry = new Contract(contractAddress, registryAbi, wallet.signer)
      const fileType = getFileType(file)
      const publicManuscriptTitle = privacyMode === 'local' ? privateManuscriptLabel : manuscriptTitle.trim()
      const publicVersionLabel = privacyMode === 'local' ? privateVersionLabel : title.trim()
      const publicChangeNote = privacyMode === 'local' ? '' : changeNote.trim()
      const transaction = await registry.registerVersion(
        manuscriptId, hash, parent, publicManuscriptTitle, publicVersionLabel, publicChangeNote, fileType, BigInt(file.size),
      )
      setToast('Transaction submitted. Waiting for confirmation…')
      const receipt = await transaction.wait()
      const storedVersion = await readContract().getVersion(hash) as [string, string, string, bigint, bigint, string, string, string, string, boolean]
      let privateDetailsSaved = true
      if (privacyMode === 'local') {
        privateDetailsSaved = savePrivateDescription(hash, { manuscriptTitle: manuscriptTitle.trim(), title: title.trim(), changeNote: changeNote.trim() })
      }
      const next: VersionRecord = {
        hash, writer: wallet.address, parentHash: parent, title: title.trim(),
        registeredAt: Number(storedVersion[3]), tx: receipt.hash,
        manuscriptId: storedVersion[0], manuscriptTitle: manuscriptTitle.trim(), changeNote: changeNote.trim(), privacyMode,
        fileType: storedVersion[8], fileSize: Number(storedVersion[4]), chainId: wallet.chainId.toString(),
        contractAddress, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
      }
      setRecords((previous) => [next, ...previous.filter((item) => item.hash !== hash)])
      setTab('overview')
      setSelectedRecord(next)
      setToast(privateDetailsSaved ? 'Version registered on-chain' : 'Registered, but this browser could not save the private descriptions')
      setFile(null); setHash(''); setParentHash(''); setLinkedManuscriptId(''); setManuscriptTitle(''); setTitle(''); setChangeNote(''); setPrivacyMode('public')
    } catch (error) { setToast(humanError(error)) }
    finally { setBusy(false) }
  }

  const verifyManuscript = async () => {
    if (!verifyHash) { setToast('Choose a manuscript file first.'); return }
    setVerifyBusy(true)
    setVerifyResult(null)
    try {
      const result = await readContract().getVersion(verifyHash) as [string, string, string, bigint, bigint, string, string, string, string, boolean]
      setVerifyResult(result[9]
        ? {
          manuscriptId: result[0], parentHash: result[1], writer: result[2], registeredAt: result[3], fileSize: result[4],
          manuscriptTitle: result[5], title: result[6], changeNote: result[7], fileType: result[8], exists: true,
        }
        : { manuscriptId: '', parentHash: '', writer: '', registeredAt: 0n, fileSize: 0n, manuscriptTitle: '', title: '', changeNote: '', fileType: '', exists: false })
    } catch (error) { setToast(humanError(error)) }
    finally { setVerifyBusy(false) }
  }

  const copyHash = async (value: string) => {
    await navigator.clipboard.writeText(value)
    setToast('Hash copied')
  }

  const submitAttestation = async (versionId: string, role: AttestationRole) => {
    if (!contractAddress) throw new Error('Registry is not configured. Deploy the contract before adding an attestation.')
    const wallet = await connectWallet()
    await assertWalletNetwork(wallet.chainId)
    setAccount(wallet.address)
    setChainId(wallet.chainId)
    const registry = new Contract(contractAddress, registryAbi, wallet.signer)
    const transaction = await registry.attestVersion(versionId, role === 'editor' ? 0 : 1)
    await transaction.wait()
    setToast(`${role === 'editor' ? 'Editor' : 'Publisher'} attestation recorded`)
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
        <div className="sidebar-bottom"><span className={`status-dot ${contractOk ? 'status-live' : ''}`} /><span title={contractOk ? undefined : registryIssue}>{contractOk ? 'Registry connected' : 'Registry offline'}</span><span className="version-label">v0.1</span></div>
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
          {tab === 'overview' && <Overview records={records} onNavigate={switchTab} contractOk={contractOk} registryIssue={registryIssue} onSelect={setSelectedRecord} />}
          {tab === 'register' && <RegisterPage file={file} hash={hash} parentHash={parentHash} manuscriptTitle={manuscriptTitle} title={title} changeNote={changeNote} privacyMode={privacyMode} linkedManuscriptId={linkedManuscriptId} busy={busy} isDragging={isDragging} setTitle={setTitle} setManuscriptTitle={setManuscriptTitle} setChangeNote={setChangeNote} setPrivacyMode={setPrivacyMode} onParentHashChange={(value) => { setParentHash(value); setLinkedManuscriptId('') }} onResolveParent={() => void resolveParentVersion()} setIsDragging={setIsDragging} onDrop={onDrop} onFile={(event) => void chooseFile(event.target.files?.[0], 'register')} onRegister={() => void registerVersion()} onCopy={() => void copyHash(hash)} />}
          {tab === 'verify' && <VerifyPage fileName={verifyFileName} hash={verifyHash} result={verifyResult} busy={verifyBusy} isDragging={isDragging} setIsDragging={setIsDragging} onDrop={onDrop} onFile={(event) => void chooseFile(event.target.files?.[0], 'verify')} onVerify={() => void verifyManuscript()} onCopy={() => void copyHash(verifyHash)} />}
          {tab === 'activity' && <ActivityPage records={records} registryConnected={contractOk} onSelect={setSelectedRecord} />}
        </div>
      </main>
      {mobileMenu && <button aria-label="Close menu" className="mobile-scrim" onClick={() => setMobileMenu(false)} />}
      {toast && <div className="toast"><span className="toast-icon"><Check size={15} /></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={14} /></button></div>}
      {selectedRecord && <VersionDetails record={selectedRecord} onClose={() => setSelectedRecord(null)} onCopy={(value) => void copyHash(value)} onAttest={submitAttestation} />}
    </div>
  )
}

function Overview({ records, onNavigate, contractOk, registryIssue, onSelect }: {
  records: VersionRecord[]; onNavigate: (tab: Tab) => void; contractOk: boolean; registryIssue: string
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
    {!contractOk && <div className="setup-note"><Network size={15} /><span>{registryIssue || 'Registry unavailable. Check the RPC and deployed contract.'}</span></div>}
    <section className="section-block">
      <div className="section-heading"><div><h2>{versionView === 'recent' ? 'Recent versions' : 'All versions'}</h2><p>{contractOk ? 'Registered on this network' : 'Cached in this browser'}</p></div>
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
  file: File | null; hash: string; parentHash: string; manuscriptTitle: string; title: string; changeNote: string
  privacyMode: 'public' | 'local'; linkedManuscriptId: string; busy: boolean; isDragging: boolean
  setManuscriptTitle: (value: string) => void; setTitle: (value: string) => void; setChangeNote: (value: string) => void
  setPrivacyMode: (value: 'public' | 'local') => void
  onParentHashChange: (value: string) => void; onResolveParent: () => void; setIsDragging: (value: boolean) => void
  onDrop: (event: DragEvent<HTMLDivElement>, mode: 'register' | 'verify') => void
  onFile: (event: ChangeEvent<HTMLInputElement>) => void; onRegister: () => void; onCopy: () => void
}) {
  return <>
    <div className="page-title-row"><div><div className="eyebrow">NEW RECORD</div><h1>Register a version</h1><p className="page-subtitle">Create a dated proof for a manuscript.</p></div></div>
    <div className="editor-layout">
      <section className="form-card editor-card">
        <label className="field-label" htmlFor="manuscript-file">Manuscript</label>
        <div id="manuscript-file"><Dropzone mode="register" fileName={props.file?.name ?? ''} dragging={props.isDragging} setDragging={props.setIsDragging} onDrop={props.onDrop} onFile={props.onFile} /></div>
        {props.file && <div className="file-meta"><FileText size={15} /><span>{props.file.name}</span><small>{getFileType(props.file)} · {props.file.size.toLocaleString()} bytes</small></div>}
        <div className="editor-divider" />
        <fieldset className="privacy-choice"><legend>Descriptive metadata</legend>
          <label><input type="radio" name="privacy-mode" checked={props.privacyMode === 'public'} onChange={() => props.setPrivacyMode('public')} /><span><strong>Public on-chain</strong><small>Title, version label, and change note are visible to everyone.</small></span></label>
          <label><input type="radio" name="privacy-mode" checked={props.privacyMode === 'local'} onChange={() => props.setPrivacyMode('local')} /><span><strong>Keep details in this browser</strong><small>Names and change note stay local. Generic labels go on-chain; file type, size, wallet, time, and fingerprint remain public.</small></span></label>
        </fieldset>
        <p className="privacy-warning"><LockKeyhole size={13} />Local-only descriptions are lost if this browser’s storage is cleared.</p>
        <label className="field-label parent-label" htmlFor="manuscript-title">Manuscript title {props.privacyMode === 'local' && <span>Local to this browser</span>}</label>
        <input id="manuscript-title" className="text-input" maxLength={160} placeholder="e.g. The Paper Harbor" value={props.manuscriptTitle} onChange={(event) => props.setManuscriptTitle(event.target.value)} />
        <label className="field-label parent-label" htmlFor="version-title">Version label {props.privacyMode === 'local' && <span>Local to this browser</span>}</label>
        <input id="version-title" className="text-input" maxLength={120} placeholder="e.g. Revised draft" value={props.title} onChange={(event) => props.setTitle(event.target.value)} />
        <label className="field-label parent-label" htmlFor="change-note">Change note <span>{props.privacyMode === 'local' ? 'Optional · local only' : 'Optional · public on-chain'}</span></label>
        <textarea id="change-note" className="text-area" maxLength={1000} placeholder="Summarize what changed in this version" value={props.changeNote} onChange={(event) => props.setChangeNote(event.target.value)} />
        <label className="field-label parent-label" htmlFor="parent-hash">Previous version <span>Optional</span></label>
        <input id="parent-hash" className="text-input mono-input" placeholder="Paste a previous version fingerprint" value={props.parentHash} onChange={(event) => props.onParentHashChange(event.target.value)} onBlur={props.onResolveParent} />
        <p className="field-hint"><Link2 size={13} />{props.linkedManuscriptId ? 'Manuscript ID linked from the previous version.' : 'Leave blank to start a new manuscript history.'}</p>
      </section>
      <aside className="proof-aside">
        <div className="proof-preview"><div className="preview-heading"><Fingerprint size={16} /><span>FINGERPRINT</span><span className="algorithm-label">SHA-256</span></div>
          <code className="preview-hash">{props.hash || 'Select a file to generate its hash'}</code>
          {props.hash && <button className="copy-button" onClick={props.onCopy}><Copy size={13} />Copy hash</button>}
        </div>
        <button className="button button-primary submit-button" disabled={props.busy || !props.hash || !props.manuscriptTitle.trim() || !props.title.trim()} onClick={props.onRegister}>
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
          {props.result.exists && props.result.manuscriptTitle === privateManuscriptLabel && props.result.title === privateVersionLabel && <p className="privacy-record-note">This record keeps descriptive details in the registering browser; generic labels are stored on-chain.</p>}
          {props.result.exists && <div className="result-details"><span><small>Manuscript</small><strong>{props.result.manuscriptTitle}</strong></span><span><small>Version</small><strong>{props.result.title}</strong></span><span><small>Type · size</small><strong>{props.result.fileType} · {Number(props.result.fileSize).toLocaleString()} bytes</strong></span><span><small>Wallet</small><strong>{shorten(props.result.writer)}</strong></span><span><small>Registered</small><strong>{new Date(Number(props.result.registeredAt) * 1000).toLocaleString()}</strong></span></div>}
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

function ActivityPage({ records, registryConnected, onSelect }: { records: VersionRecord[]; registryConnected: boolean; onSelect: (record: VersionRecord) => void }) {
  const [view, setView] = useState<'table' | 'graph'>('table')
  const orderedRecords = [...records].sort((a, b) => b.registeredAt - a.registeredAt)
  const paths = buildVersionPaths(records)
  return <>
    <div className="page-title-row activity-title-row">
      <div><div className="eyebrow">YOUR RECORDS</div><h1>Activity</h1><p className="page-subtitle">{registryConnected ? 'Versions registered on this network.' : 'Cached versions from this browser.'}</p></div>
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

function VersionDetails({ record, onClose, onCopy, onAttest }: { record: VersionRecord; onClose: () => void; onCopy: (value: string) => void; onAttest: (versionId: string, role: AttestationRole) => Promise<void> }) {
  const [children, setChildren] = useState<string[]>([])
  const [attestations, setAttestations] = useState<ChainAttestation[]>([])
  const [role, setRole] = useState<AttestationRole>('editor')
  const [attesting, setAttesting] = useState(false)
  useEffect(() => {
    let active = true
    if (record.legacy) return () => { active = false }
    const registry = readContract()
    Promise.all([registry.getChildren(record.hash), registry.getAttestations(record.hash)]).then(([childIds, entries]) => {
      if (!active) return
      setChildren(Array.from(childIds as string[]))
      setAttestations(Array.from(entries as ChainAttestation[]))
    }).catch(() => { if (active) { setChildren([]); setAttestations([]) } })
    return () => { active = false }
  }, [record.hash, record.legacy])
  const attest = async () => {
    setAttesting(true)
    try {
      await onAttest(record.hash, role)
      const entries = await readContract().getAttestations(record.hash) as ChainAttestation[]
      setAttestations(Array.from(entries))
    } catch { /* the app toast reports the wallet or transaction error */ }
    finally { setAttesting(false) }
  }
  return <div className="modal-layer" onClick={onClose}>
    <section className="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-modal-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-heading"><div><span className="eyebrow">VERSION RECORD</span><h2 id="version-modal-title">{record.manuscriptTitle || 'Manuscript'}</h2><p className="modal-subtitle">{record.title}</p></div><button className="modal-close" aria-label="Close version details" onClick={onClose}><X size={17} /></button></div>
      {record.privacyMode === 'local' && <p className="privacy-record-note">{record.manuscriptTitle === privateManuscriptLabel ? 'Descriptive details were kept in the registering browser and are unavailable here.' : 'The title, version label, and change note below are shown from this browser only; generic labels are stored on-chain.'}</p>}
      <dl className="version-details-list">
        <div className="detail-hash-row"><dt>Manuscript ID</dt><dd className="mono">{record.manuscriptId || 'Unavailable · legacy record'}</dd></div>
        <div className="detail-hash-row"><dt>Version ID</dt><dd className="mono">{record.hash}</dd></div>
        <div><dt>Registered</dt><dd>{new Date(record.registeredAt * 1000).toLocaleString()}</dd></div>
        <div><dt>File</dt><dd>{record.fileType || 'Unknown'} · {record.fileSize.toLocaleString()} bytes</dd></div>
        <div><dt>Wallet</dt><dd className="mono">{record.writer}</dd></div>
        <div className="detail-hash-row"><dt>Previous version</dt><dd className="mono">{record.parentHash.toLowerCase() === zeroHash ? 'First version' : record.parentHash}</dd></div>
        <div className="detail-hash-row"><dt>Next versions</dt><dd className="mono">{record.legacy ? 'Unavailable · legacy record' : children.length ? children.join(', ') : 'None registered yet'}</dd></div>
        {record.changeNote && <div className="detail-note"><dt>Change note</dt><dd>{record.changeNote}</dd></div>}
        <div><dt>Network · chain ID</dt><dd>{record.chainId ? `Chain ${record.chainId}` : 'Unavailable · legacy record'}</dd></div>
        <div className="detail-hash-row"><dt>Contract</dt><dd className="mono">{record.contractAddress || 'Unavailable · legacy record'}</dd></div>
        <div className="detail-hash-row"><dt>Transaction</dt><dd className="mono">{record.tx || 'Unavailable · legacy record'}</dd></div>
        <div className="detail-hash-row"><dt>Block · hash</dt><dd className="mono">{record.blockNumber ? `${record.blockNumber} · ${record.blockHash}` : 'Unavailable · legacy record'}</dd></div>
      </dl>
      <div className="modal-hash"><span>SHA-256 fingerprint</span><code>{record.hash}</code></div>
      <section className="attestation-section"><div className="attestation-heading"><h3>Attestations</h3><span>{attestations.length}</span></div>
        <p>Signing wallet and declared role are recorded on-chain.</p>
        {attestations.length ? <ul className="attestation-list">{attestations.map((entry, index) => <li key={`${entry.signer}-${entry.role}-${index}`}><span>{entry.role === 0 ? 'Editor' : 'Publisher'}</span><code>{entry.signer}</code><time>{new Date(Number(entry.attestedAt) * 1000).toLocaleString()}</time></li>)}</ul> : <div className="attestation-empty">No attestations yet.</div>}
        {!record.legacy && <div className="attestation-action"><select aria-label="Attestation role" value={role} onChange={(event) => setRole(event.target.value as AttestationRole)}><option value="editor">Editor</option><option value="publisher">Publisher</option></select><button className="button button-secondary" disabled={attesting} onClick={() => void attest()}>{attesting ? 'Signing…' : 'Sign attestation'}</button></div>}
        <small className="attestation-disclosure">The registry records the wallet’s declared role; it does not verify the signer’s real-world identity or authority.</small>
      </section>
      <button className="button button-primary modal-copy" onClick={() => onCopy(record.hash)}><Copy size={14} />Copy fingerprint</button>
    </section>
  </div>
}

export default App
