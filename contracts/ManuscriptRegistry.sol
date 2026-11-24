// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @notice Stores public version metadata and attestations. Manuscript contents stay off-chain.
contract ManuscriptRegistry {
    enum AttestationRole { Editor, Publisher }

    struct Version {
        bytes32 manuscriptId;
        bytes32 parentVersionId;
        address writer;
        uint64 registeredAt;
        uint64 fileSize;
        string manuscriptTitle;
        string versionLabel;
        string changeNote;
        string fileType;
    }

    struct Attestation {
        address signer;
        AttestationRole role;
        uint64 attestedAt;
    }

    mapping(bytes32 => Version) private versions;
    mapping(bytes32 => bytes32[]) private children;
    mapping(bytes32 => Attestation[]) private attestations;
    mapping(bytes32 => mapping(address => mapping(AttestationRole => bool))) private hasAttested;

    event VersionRegistered(
        bytes32 indexed versionId,
        bytes32 indexed manuscriptId,
        bytes32 indexed parentVersionId,
        address writer,
        uint64 registeredAt,
        uint64 fileSize,
        string manuscriptTitle,
        string versionLabel,
        string changeNote,
        string fileType
    );

    event VersionAttested(
        bytes32 indexed versionId,
        address indexed signer,
        AttestationRole role,
        uint64 attestedAt
    );

    error EmptyId();
    error AlreadyRegistered(bytes32 versionId);
    error InvalidMetadata();
    error UnknownParent(bytes32 parentVersionId);
    error ManuscriptMismatch(bytes32 parentVersionId);
    error UnknownVersion(bytes32 versionId);
    error DuplicateAttestation(bytes32 versionId, address signer, AttestationRole role);

    function registerVersion(
        bytes32 manuscriptId,
        bytes32 versionId,
        bytes32 parentVersionId,
        string calldata manuscriptTitle,
        string calldata versionLabel,
        string calldata changeNote,
        string calldata fileType,
        uint64 fileSize
    ) external {
        if (manuscriptId == bytes32(0) || versionId == bytes32(0)) revert EmptyId();
        if (versions[versionId].writer != address(0)) revert AlreadyRegistered(versionId);
        if (
            bytes(manuscriptTitle).length == 0 || bytes(manuscriptTitle).length > 160 ||
            bytes(versionLabel).length == 0 || bytes(versionLabel).length > 120 ||
            bytes(changeNote).length > 1000 || bytes(fileType).length == 0 || bytes(fileType).length > 100
        ) revert InvalidMetadata();

        if (parentVersionId != bytes32(0)) {
            Version storage parent = versions[parentVersionId];
            if (parent.writer == address(0)) revert UnknownParent(parentVersionId);
            if (parent.manuscriptId != manuscriptId) revert ManuscriptMismatch(parentVersionId);
            children[parentVersionId].push(versionId);
        }

        uint64 registeredAt = uint64(block.timestamp);
        versions[versionId] = Version(
            manuscriptId,
            parentVersionId,
            msg.sender,
            registeredAt,
            fileSize,
            manuscriptTitle,
            versionLabel,
            changeNote,
            fileType
        );

        emit VersionRegistered(
            versionId,
            manuscriptId,
            parentVersionId,
            msg.sender,
            registeredAt,
            fileSize,
            manuscriptTitle,
            versionLabel,
            changeNote,
            fileType
        );
    }

    /// @notice Records the signing wallet's declared relationship to this version.
    function attestVersion(bytes32 versionId, AttestationRole role) external {
        if (versions[versionId].writer == address(0)) revert UnknownVersion(versionId);
        if (hasAttested[versionId][msg.sender][role]) {
            revert DuplicateAttestation(versionId, msg.sender, role);
        }

        uint64 attestedAt = uint64(block.timestamp);
        hasAttested[versionId][msg.sender][role] = true;
        attestations[versionId].push(Attestation(msg.sender, role, attestedAt));
        emit VersionAttested(versionId, msg.sender, role, attestedAt);
    }

    function getVersion(bytes32 versionId)
        external
        view
        returns (
            bytes32 manuscriptId,
            bytes32 parentVersionId,
            address writer,
            uint64 registeredAt,
            uint64 fileSize,
            string memory manuscriptTitle,
            string memory versionLabel,
            string memory changeNote,
            string memory fileType,
            bool exists
        )
    {
        Version storage version = versions[versionId];
        exists = version.writer != address(0);
        return (
            version.manuscriptId,
            version.parentVersionId,
            version.writer,
            version.registeredAt,
            version.fileSize,
            version.manuscriptTitle,
            version.versionLabel,
            version.changeNote,
            version.fileType,
            exists
        );
    }

    function getChildren(bytes32 versionId) external view returns (bytes32[] memory) {
        return children[versionId];
    }

    function getAttestations(bytes32 versionId) external view returns (Attestation[] memory) {
        return attestations[versionId];
    }
}
