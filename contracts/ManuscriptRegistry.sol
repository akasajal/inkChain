// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Registers immutable fingerprints of manuscript versions. Document contents stay off-chain.
contract ManuscriptRegistry {
    struct Version {
        address writer;
        uint64 registeredAt;
        bytes32 parentHash;
        string title;
    }

    mapping(bytes32 => Version) private versions;

    event VersionRegistered(
        bytes32 indexed documentHash,
        address indexed writer,
        bytes32 indexed parentHash,
        uint64 registeredAt,
        string title
    );

    error EmptyHash();
    error AlreadyRegistered(bytes32 documentHash);
    error InvalidTitle();
    error UnknownParent(bytes32 parentHash);

    function registerVersion(bytes32 documentHash, bytes32 parentHash, string calldata title) external {
        if (documentHash == bytes32(0)) revert EmptyHash();
        if (versions[documentHash].writer != address(0)) revert AlreadyRegistered(documentHash);
        if (bytes(title).length == 0 || bytes(title).length > 120) revert InvalidTitle();
        if (parentHash != bytes32(0) && versions[parentHash].writer == address(0)) revert UnknownParent(parentHash);

        uint64 registeredAt = uint64(block.timestamp);
        versions[documentHash] = Version(msg.sender, registeredAt, parentHash, title);
        emit VersionRegistered(documentHash, msg.sender, parentHash, registeredAt, title);
    }

    function getVersion(bytes32 documentHash)
        external
        view
        returns (address writer, uint64 registeredAt, bytes32 parentHash, string memory title, bool exists)
    {
        Version storage version = versions[documentHash];
        exists = version.writer != address(0);
        return (version.writer, version.registeredAt, version.parentHash, version.title, exists);
    }
}
