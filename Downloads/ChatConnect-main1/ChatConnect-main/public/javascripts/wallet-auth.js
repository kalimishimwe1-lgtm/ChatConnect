async function connectWalletAndAuthenticate(purpose, button) {
    const message = document.getElementById("wallet-auth-message");
    const buttonText = button.textContent;
    button.disabled = true;
    button.textContent = "Connecting...";
    message.textContent = "Connect your wallet to continue.";

    try {
        if (!window.ethereum || typeof window.ethereum.request !== "function") {
            throw new Error("Install or unlock a browser wallet such as MetaMask.");
        }

        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const address = Array.isArray(accounts) ? accounts[0] : null;
        if (typeof address !== "string") {
            throw new Error("No wallet account was selected.");
        }

        const challengeResponse = await fetch("/wallet/challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address, purpose }),
        });
        const challenge = await challengeResponse.json();
        if (!challengeResponse.ok || typeof challenge.message !== "string") {
            throw new Error(challenge.error || "Could not start wallet verification.");
        }

        message.textContent = "Approve the one-time signature request in your wallet.";
        const signature = await window.ethereum.request({
            method: "personal_sign",
            params: [challenge.message, address],
        });
        const endpoint = purpose === "login" ? "/wallet/login" : "/wallet/link";
        const verifyResponse = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address, signature }),
        });
        const result = await verifyResponse.json();
        if (!verifyResponse.ok || !result.ok) {
            throw new Error(result.error || "Wallet verification failed.");
        }

        if (purpose === "login") {
            window.location.assign(result.redirect || "/");
            return;
        }

        const addressLabel = document.createElement("code");
        addressLabel.id = "wallet-linked-address";
        addressLabel.textContent = result.address;
        message.replaceChildren(document.createTextNode("Wallet linked: "), addressLabel);
        button.remove();
    } catch (error) {
        message.textContent = error && error.message
            ? error.message
            : "Wallet verification failed.";
        button.disabled = false;
        button.textContent = buttonText;
    }
}

document.getElementById("wallet-login-button")?.addEventListener("click", function () {
    connectWalletAndAuthenticate("login", this);
});

document.getElementById("wallet-link-button")?.addEventListener("click", function () {
    connectWalletAndAuthenticate("link", this);
});
