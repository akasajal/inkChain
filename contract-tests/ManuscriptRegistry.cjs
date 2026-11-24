const assert = require('node:assert/strict')
const { ethers } = require('hardhat')

const zeroId = ethers.ZeroHash
const id = (value) => ethers.id(value)

describe('ManuscriptRegistry', function () {
  let registry
  let owner
  let editor
  let publisher

  async function registerVersion({
    manuscriptId = id('manuscript-1'),
    versionId = id('version-1'),
    parentVersionId = zeroId,
    manuscriptTitle = 'A manuscript',
    versionLabel = 'First draft',
    changeNote = 'Initial draft',
    fileType = 'text/plain',
    fileSize = 128n,
    contract = registry,
  } = {}) {
    return contract.registerVersion(
      manuscriptId,
      versionId,
      parentVersionId,
      manuscriptTitle,
      versionLabel,
      changeNote,
      fileType,
      fileSize,
    )
  }

  async function expectCustomError(action, errorName) {
    let failure
    try { await action() } catch (error) { failure = error }
    assert.ok(failure, `Expected ${errorName} to be thrown`)
    const message = [failure.shortMessage, failure.message, failure.reason]
      .filter(Boolean)
      .join(' ')
    assert.ok(message.includes(errorName), `Expected ${errorName}, received: ${message}`)
  }

  beforeEach(async function () {
    ;[owner, editor, publisher] = await ethers.getSigners()
    const factory = await ethers.getContractFactory('ManuscriptRegistry')
    registry = await factory.deploy()
    await registry.waitForDeployment()
  })

  it('stores the fingerprint and complete version metadata', async function () {
    const manuscriptId = id('paper-harbor')
    const versionId = id('paper-harbor-v1')
    await (await registerVersion({ manuscriptId, versionId, fileType: 'application/pdf', fileSize: 4096n })).wait()

    const version = await registry.getVersion(versionId)
    assert.equal(version.manuscriptId, manuscriptId)
    assert.equal(version.parentVersionId, zeroId)
    assert.equal(version.writer, owner.address)
    assert.ok(version.registeredAt > 0n)
    assert.equal(version.fileSize, 4096n)
    assert.equal(version.manuscriptTitle, 'A manuscript')
    assert.equal(version.versionLabel, 'First draft')
    assert.equal(version.changeNote, 'Initial draft')
    assert.equal(version.fileType, 'application/pdf')
    assert.equal(version.exists, true)

    const events = await registry.queryFilter(registry.filters.VersionRegistered())
    assert.equal(events.length, 1)
    assert.equal(events[0].args.versionId, versionId)
  })

  it('links versions to a parent and records its child', async function () {
    const manuscriptId = id('paper-harbor')
    const first = id('paper-harbor-v1')
    const second = id('paper-harbor-v2')
    await (await registerVersion({ manuscriptId, versionId: first })).wait()
    await (await registerVersion({
      manuscriptId,
      versionId: second,
      parentVersionId: first,
      versionLabel: 'Second draft',
    })).wait()

    const version = await registry.getVersion(second)
    assert.equal(version.manuscriptId, manuscriptId)
    assert.equal(version.parentVersionId, first)
    assert.deepEqual(Array.from(await registry.getChildren(first)), [second])
  })

  it('rejects a duplicate version fingerprint', async function () {
    const versionId = id('paper-harbor-v1')
    await (await registerVersion({ versionId })).wait()
    await expectCustomError(() => registerVersion({ versionId }).then((tx) => tx.wait()), 'AlreadyRegistered')
  })

  it('rejects an unknown parent and a manuscript mismatch', async function () {
    const unknownParent = id('missing-parent')
    await expectCustomError(
      () => registerVersion({ versionId: id('orphan'), parentVersionId: unknownParent }).then((tx) => tx.wait()),
      'UnknownParent',
    )

    const parentId = id('parent')
    await (await registerVersion({ manuscriptId: id('manuscript-a'), versionId: parentId })).wait()
    await expectCustomError(
      () => registerVersion({ manuscriptId: id('manuscript-b'), versionId: id('mismatched-child'), parentVersionId: parentId }).then((tx) => tx.wait()),
      'ManuscriptMismatch',
    )
  })

  it('rejects empty titles, labels, and file types', async function () {
    await expectCustomError(
      () => registerVersion({ manuscriptTitle: '' }).then((tx) => tx.wait()),
      'InvalidMetadata',
    )
    await expectCustomError(
      () => registerVersion({ versionId: id('empty-label'), versionLabel: '' }).then((tx) => tx.wait()),
      'InvalidMetadata',
    )
    await expectCustomError(
      () => registerVersion({ versionId: id('empty-file-type'), fileType: '' }).then((tx) => tx.wait()),
      'InvalidMetadata',
    )
  })

  it('records Editor and Publisher attestations with signer and time', async function () {
    const versionId = id('attested-version')
    await (await registerVersion({ versionId })).wait()
    await (await registry.connect(editor).attestVersion(versionId, 0)).wait()
    await (await registry.connect(publisher).attestVersion(versionId, 1)).wait()

    const attestations = await registry.getAttestations(versionId)
    assert.equal(attestations.length, 2)
    assert.equal(attestations[0].signer, editor.address)
    assert.equal(Number(attestations[0].role), 0)
    assert.ok(attestations[0].attestedAt > 0n)
    assert.equal(attestations[1].signer, publisher.address)
    assert.equal(Number(attestations[1].role), 1)
  })

  it('prevents duplicate attestations by the same wallet and role', async function () {
    const versionId = id('once-attested')
    await (await registerVersion({ versionId })).wait()
    await (await registry.connect(editor).attestVersion(versionId, 0)).wait()
    await expectCustomError(
      () => registry.connect(editor).attestVersion.staticCall(versionId, 0),
      'DuplicateAttestation',
    )

    await (await registry.connect(editor).attestVersion(versionId, 1)).wait()
    assert.equal((await registry.getAttestations(versionId)).length, 2)
  })

  it('rejects attestations for unknown versions', async function () {
    await expectCustomError(
      () => registry.connect(editor).attestVersion.staticCall(id('unknown-version'), 0),
      'UnknownVersion',
    )
  })
})
