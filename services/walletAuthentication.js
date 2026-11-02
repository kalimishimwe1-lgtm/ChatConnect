const { getAddress, verifyMessage } = require("ethers");

const normalizeWalletAddress = (address) => {
    if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return null;
    }

    try {
        return getAddress(address).toLowerCase();
    } catch {
        return null;
    }
};

const verifyWalletChallenge = (message, signature, expectedAddress) => {
    if (typeof message !== "string" || typeof signature !== "string") {
        return false;
    }

    try {
        const recoveredAddress = normalizeWalletAddress(verifyMessage(message, signature));
        return recoveredAddress !== null && recoveredAddress === expectedAddress;
    } catch {
        return false;
    }
};

module.exports = { normalizeWalletAddress, verifyWalletChallenge };
