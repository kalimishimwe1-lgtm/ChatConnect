const socket = io();
const currentContactNo = $("#sidepanel #profile #expanded input").val();
const currentUserId = String($("#profile-img").data("userId"));
let activeChat = null;
let docHeight = $(document).height();
const displayedMessageIds = new Set();
let searchTimer = null;
let searchRequest = null;
let activeCall = null;
let incomingCall = null;
let voiceRecorder = null;
let voiceRecordingStream = null;
let voiceRecordingTimer = null;
let voiceRecordingStartedAt = 0;
const MAX_VOICE_NOTE_SECONDS = 50 * 60;
const MAX_VOICE_NOTE_BYTES = 20 * 1024 * 1024;

async function loadIceServers() {
    const response = await fetch("/ice-servers");
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.iceServers)) {
        throw new Error("Call network settings could not be loaded.");
    }
    return result.iceServers;
}

function scrollToLatestMessage() {
    $(".messages").animate({ scrollTop: docHeight }, "fast");
}

function displayMessage(mode, imgSrc, message, time, fromContact) {
    const item = $("<li>").addClass(mode);
    const avatar = $("<img>").attr("src", imgSrc || "").attr("alt", "");
    const content = $("<p>").text(message);
    const timestamp = $("<span>")
        .addClass("float-right small text ml-2")
        .text(time);

    content.append(timestamp);
    item.append(avatar, content).attr("data-from-contact", fromContact || "")
        .appendTo($(".messages ul"));
    docHeight += 93;
}

function displayImageMessage(mode, userImg, imageUrl, fromContact) {
    const item = $("<li>").addClass(mode);
    item.append(
        $("<img>").attr("src", userImg || "").attr("alt", ""),
        $("<img>")
            .attr("src", imageUrl)
            .attr("alt", "Shared image")
            .addClass("message-image")
    );
    item.attr("data-from-contact", fromContact || "").appendTo($(".messages ul"));
    docHeight += 93;
}

function displayAudioMessage(mode, userImg, audioUrl, fromContact) {
    const item = $("<li>").addClass(mode);
    const avatar = $("<img>").attr("src", userImg || "").attr("alt", "");
    const player = $("<audio>")
        .addClass("voice-note-player")
        .attr({
            controls: true,
            preload: "metadata",
            src: audioUrl,
            "aria-label": "Voice note",
        });
    item.append(avatar, player)
        .attr("data-from-contact", fromContact || "")
        .appendTo($(".messages ul"));
    docHeight += 93;
}

function showMessage(message) {
    if (message.id !== undefined && activeChat) {
        const chatId = activeChat.type === "group"
            ? activeChat.id
            : activeChat.contactNo;
        const messageId = `${activeChat.type}:${chatId}:${message.id}`;
        if (displayedMessageIds.has(messageId)) return;
        displayedMessageIds.add(messageId);
    }

    const formattedTime = moment(message.datetime).format("hh:mm A");
    const mode = message.from === currentContactNo ? "replies" : "sent";
    if (message.type === "audio") {
        displayAudioMessage(mode, message.img, message.message, message.from);
    } else if (message.type === "image") {
        displayImageMessage(mode, message.img, message.message, message.from);
    } else {
        displayMessage(mode, message.img, message.message, formattedTime, message.from);
    }
}

function loadChats() {
    if (!activeChat) return;

    const requestedChat = { ...activeChat };
    const details = requestedChat.type === "group"
        ? { groupId: requestedChat.id }
        : { to: requestedChat.contactNo };

    socket.emit("load-message", details, (messages) => {
        if (
            !activeChat ||
            activeChat.type !== requestedChat.type ||
            (requestedChat.type === "group"
                ? activeChat.id !== requestedChat.id
                : activeChat.contactNo !== requestedChat.contactNo) ||
            !Array.isArray(messages)
        ) {
            return;
        }

        messages.forEach(showMessage);
        scrollToLatestMessage();
    });
}

socket.on("connect", () => {
    if (activeChat) loadChats();
});

function showUserInMainPanel(user) {
    if (!user || !user.contactNo) return;

    activeChat = { type: "direct", contactNo: String(user.contactNo) };
    $("#contacts .contact").removeClass("active").filter(function () {
        return this.dataset.contactNo === String(user.contactNo);
    }).addClass("active");
    toggleSelectChatMessage(false);
    $(".contact-profile").removeClass("group-chat");
    const userImage = window.profilePicturesByContact[user.contactNo] || user.img;
    $(".contact-profile img").attr("src", userImage || "");
    $(".contact-profile .name").text(user.name);
    $(".contact-profile .small.text.d-block").text(user.contactNo);
    $(".contact-profile .about").text(user.about || "");
    $(".messages ul").empty();
    displayedMessageIds.clear();
    docHeight = 0;
    loadChats();
}

function showGroupInMainPanel(group) {
    activeChat = { type: "group", id: String(group.id), name: group.name };
    $("#contacts .contact").removeClass("active").filter(function () {
        return this.dataset.groupId === String(group.id);
    }).addClass("active");
    toggleSelectChatMessage(false);
    $(".contact-profile").addClass("group-chat");
    $(".contact-profile .name").text(group.name);
    $(".contact-profile .small.text.d-block").text("Private group");
    $(".contact-profile .about").text("");
    $(".messages ul").empty();
    displayedMessageIds.clear();
    docHeight = 0;
    loadChats();
}

function sendMessage(messageOverride = null, overrideType = null, targetChat = activeChat, onComplete = null) {
    if (!targetChat) return false;

    const input = $(".message-input input");
    const text = input.val();
    const message = messageOverride === null ? text : messageOverride;
    const type = overrideType || (messageOverride === null ? "text" : "image");
    if (!message || (type === "text" && !$.trim(message))) return false;

    const data = {
        type,
        message,
    };
    if (targetChat.type === "group") {
        data.groupId = targetChat.id;
    } else {
        data.to = targetChat.contactNo;
    }
    const sentChat = { ...targetChat };

    socket.emit("send-message", data, (result) => {
        if (!result || !result.ok) {
            if (type === "text" && !input.val()) input.val(text);
            window.alert(result && result.message
                ? result.message
                : "The message could not be sent.");
            if (onComplete) onComplete(false);
            return;
        }

        const stillViewingSentChat = activeChat &&
            activeChat.type === sentChat.type &&
            (sentChat.type === "group"
                ? activeChat.id === sentChat.id
                : activeChat.contactNo === sentChat.contactNo);
        if (stillViewingSentChat) {
            showMessage({
                ...result.message,
                from: currentContactNo,
            });
            scrollToLatestMessage();
        }
        if (data.to && data.type === "text") {
            $("#contacts .contact .meta .preview")
                .filter(function () { return this.id === data.to; })
                .text(`You: ${data.message}`);
        }
        if (onComplete) onComplete(true);
    });

    if (type === "text") input.val(null);
    scrollToLatestMessage();
    return false;
}

function receiveMessage(message) {
    if (!activeChat) return;

    if (activeChat.type === "group") {
        if (String(message.groupId) !== activeChat.id) return;
    } else if (message.to !== currentContactNo || message.from !== activeChat.contactNo) {
        return;
    }

    showMessage(message);
    scrollToLatestMessage();
}

function callRequest(eventName, payload) {
    return new Promise((resolve) => {
        socket.timeout(15000).emit(eventName, payload, (error, result) => {
            if (error) {
                resolve({ ok: false, message: "The call request timed out. Please try again." });
                return;
            }
            resolve(result || { ok: false, message: "The call request could not be completed." });
        });
    });
}

function showCallPanel(status, incoming = false) {
    $("#call-panel").prop("hidden", false);
    $("#call-status").text(status);
    $("#incoming-call-actions").prop("hidden", !incoming);
    $("#end-call").prop("hidden", incoming);
}

function attachLocalCallStream(stream, mode) {
    const video = $("#local-call-video");
    video[0].srcObject = stream;
    video.toggleClass("call-audio-only", mode !== "video");
    $("#remote-call-videos").empty();
}

async function startCall(mode) {
    if (!activeChat || activeCall || incomingCall) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        window.alert("Calls require a supported browser and a secure HTTPS connection.");
        return;
    }

    const targetChat = { ...activeChat };
    let stream;
    try {
        const iceServers = await loadIceServers();
        stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: mode === "video",
        });
        const request = targetChat.type === "group"
            ? { chatType: "group", groupId: targetChat.id, mode }
            : { chatType: "direct", contactNo: targetChat.contactNo, mode };
        const result = await callRequest("call:start", request);
        if (!result.ok) {
            stream.getTracks().forEach((track) => track.stop());
            window.alert(result.message);
            return;
        }

        activeCall = {
            callId: result.callId,
            mode,
            chat: targetChat,
            localStream: stream,
            iceServers,
            peers: new Map(),
        };
        attachLocalCallStream(stream, mode);
        showCallPanel(
            `${mode === "video" ? "Video" : "Audio"} call: ${targetChat.name || targetChat.contactNo}`
        );
        activeCall.timeout = window.setTimeout(() => {
            if (activeCall && activeCall.callId === result.callId &&
                activeCall.peers.size === 0) {
                finishCall(true);
                showCallNotice("No one answered the call.");
            }
        }, 60000);
    } catch (error) {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        window.alert(error.message || "Could not access your microphone or camera.");
    }
}

async function acceptIncomingCall() {
    if (!incomingCall || activeCall) return;
    const invitation = incomingCall;
    let stream;
    try {
        const iceServers = await loadIceServers();
        stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: invitation.mode === "video",
        });
        activeCall = {
            callId: invitation.callId,
            mode: invitation.mode,
            chat: invitation.chat,
            localStream: stream,
            iceServers,
            peers: new Map(),
        };
        incomingCall = null;
        attachLocalCallStream(stream, activeCall.mode);
        showCallPanel(`${activeCall.mode === "video" ? "Video" : "Audio"} call with ${invitation.caller.name}`);

        const result = await callRequest("call:join", { callId: activeCall.callId });
        if (!result.ok) {
            finishCall(true);
            window.alert(result.message);
            return;
        }
        result.participants.forEach((participant) => createCallPeer(participant, false));
    } catch (error) {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        if (activeCall && activeCall.callId === invitation.callId) {
            finishCall(true);
        } else {
            socket.emit("call:decline", { callId: invitation.callId });
        }
        incomingCall = null;
        $("#call-panel").prop("hidden", true);
        window.alert(error.message || "Could not access your microphone or camera.");
    }
}

async function createCallPeer(participant, createOffer) {
    if (!activeCall || participant.id === currentUserId ||
        activeCall.peers.has(String(participant.id))) return;

    const call = activeCall;
    const userId = String(participant.id);
    const peer = {
        connection: new RTCPeerConnection({ iceServers: call.iceServers }),
        candidateQueue: [],
        remoteStream: new MediaStream(),
        user: participant,
        tile: $("<div>").addClass("remote-call-tile"),
    };
    const media = call.mode === "video"
        ? $("<video>").attr({ autoplay: true, playsinline: true, "aria-label": `${participant.name}'s video` })
        : $("<audio>").attr({ autoplay: true, "aria-label": `${participant.name}'s audio` });
    peer.tile.append(media, $("<p>").text(participant.name));
    $("#remote-call-videos").append(peer.tile);
    call.peers.set(userId, peer);

    peer.connection.onicecandidate = (event) => {
        if (event.candidate && activeCall === call) {
            socket.emit("call:signal", {
                callId: call.callId,
                toUserId: userId,
                signal: { type: "candidate", candidate: event.candidate.toJSON() },
            });
        }
    };
    peer.connection.ontrack = (event) => {
        const remoteStream = event.streams[0] || peer.remoteStream;
        if (!event.streams[0] && !remoteStream.getTracks().includes(event.track)) {
            remoteStream.addTrack(event.track);
        }
        media[0].srcObject = remoteStream;
        media[0].play().catch((error) => {
            console.warn("Call media autoplay was blocked:", error);
            media.attr("controls", true);
            $("#call-status").text("Call media was blocked. Select play on the participant's media.");
        });
    };
    peer.connection.onconnectionstatechange = () => {
        if (peer.connection.connectionState === "failed") {
            $("#call-status").text("A call connection failed. Check your network and try again.");
        }
    };
    call.localStream.getTracks().forEach((track) => {
        peer.connection.addTrack(track, call.localStream);
    });

    if (createOffer) {
        try {
            const offer = await peer.connection.createOffer();
            await peer.connection.setLocalDescription(offer);
            if (activeCall !== call) return;
            socket.emit("call:signal", {
                callId: call.callId,
                toUserId: userId,
                signal: { type: "offer", description: peer.connection.localDescription },
            });
        } catch (error) {
            console.error("Could not create a call offer:", error);
            $("#call-status").text("Could not connect to a call participant.");
        }
    }
}

async function handleCallSignal(data) {
    if (!activeCall || data.callId !== activeCall.callId || !data.user) return;
    const call = activeCall;
    await createCallPeer(data.user, false);
    if (activeCall !== call) return;
    const peer = call.peers.get(String(data.fromUserId));
    if (!peer) return;

    try {
        if (data.signal.type === "offer") {
            await peer.connection.setRemoteDescription(data.signal.description);
            while (peer.candidateQueue.length) {
                await peer.connection.addIceCandidate(peer.candidateQueue.shift());
            }
            const answer = await peer.connection.createAnswer();
            await peer.connection.setLocalDescription(answer);
            if (activeCall !== call) return;
            socket.emit("call:signal", {
                callId: call.callId,
                toUserId: String(data.fromUserId),
                signal: { type: "answer", description: peer.connection.localDescription },
            });
        } else if (data.signal.type === "answer") {
            await peer.connection.setRemoteDescription(data.signal.description);
            if (activeCall !== call) return;
            while (peer.candidateQueue.length) {
                await peer.connection.addIceCandidate(peer.candidateQueue.shift());
            }
        } else if (data.signal.type === "candidate") {
            if (peer.connection.remoteDescription) {
                await peer.connection.addIceCandidate(data.signal.candidate);
            } else {
                peer.candidateQueue.push(data.signal.candidate);
            }
        }
    } catch (error) {
        console.error("Could not process call signaling:", error);
        $("#call-status").text("A call connection failed. Check your network and try again.");
    }
}

function finishCall(notifyServer) {
    if (!activeCall) return;
    const call = activeCall;
    activeCall = null;
    if (call.timeout) window.clearTimeout(call.timeout);
    if (notifyServer) socket.emit("call:leave", { callId: call.callId });
    call.peers.forEach((peer) => {
        peer.connection.close();
        peer.tile.remove();
    });
    call.localStream.getTracks().forEach((track) => track.stop());
    $("#local-call-video").each(function () { this.srcObject = null; });
    $("#remote-call-videos").empty();
    $("#call-panel").prop("hidden", true);
}

function showCallNotice(message) {
    if (activeCall || incomingCall) return;
    showCallPanel(message);
    $("#end-call").prop("hidden", true);
    window.setTimeout(() => {
        if (!activeCall && !incomingCall) $("#call-panel").prop("hidden", true);
    }, 4000);
}

function declineIncomingCall() {
    if (!incomingCall) return;
    socket.emit("call:decline", { callId: incomingCall.callId });
    incomingCall = null;
    $("#call-panel").prop("hidden", true);
}

async function startVoiceNote() {
    const button = $("#record-voice-note");
    const status = $("#voice-note-status");
    if (!activeChat) {
        status.text("Select a chat before recording.");
        return;
    }

    if (voiceRecorder && voiceRecorder.state === "recording") {
        voiceRecorder.stop();
        return;
    }
    if (voiceRecorder) {
        status.text("Finishing the previous recording. Please wait.");
        return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia ||
        typeof MediaRecorder === "undefined") {
        status.text("Voice recording is not supported by this browser.");
        return;
    }

    let recordingStream;
    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = [
            "audio/webm;codecs=opus",
            "audio/ogg;codecs=opus",
            "audio/mp4",
        ].find((candidate) =>
            typeof MediaRecorder.isTypeSupported === "function" &&
            MediaRecorder.isTypeSupported(candidate)
        );
        const recordingChunks = [];
        let recordingFailed = false;
        const recorder = new MediaRecorder(
            recordingStream,
            mimeType ? { mimeType, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }
        );
        voiceRecorder = recorder;
        const recordingChat = { ...activeChat };
        voiceRecordingStartedAt = Date.now();
        recorder.ondataavailable = (event) => {
            if (event.data.size) recordingChunks.push(event.data);
        };
        recorder.onerror = () => {
            recordingFailed = true;
            status.text("Recording failed. Check microphone permissions and try again.");
        };
        recorder.onstop = () => {
            const recordedBlob = new Blob(recordingChunks, {
                type: recorder.mimeType || "audio/webm",
            });
            recordingStream.getTracks().forEach((track) => track.stop());
            if (voiceRecorder === recorder) voiceRecorder = null;
            if (voiceRecordingStream === recordingStream) voiceRecordingStream = null;
            button.removeClass("recording")
                .attr({ "aria-label": "Record voice note", title: "Record voice note" });
            window.clearInterval(voiceRecordingTimer);
            if (recordingFailed) return;
            if (!recordedBlob.size) {
                status.text("No audio was recorded.");
                return;
            }
            if (recordedBlob.size > MAX_VOICE_NOTE_BYTES) {
                status.text("This recording is too large to send. Please record a shorter note.");
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                sendMessage(reader.result, "audio", recordingChat, (sent) => {
                    status.text(sent ? "Voice note sent." : "Voice note could not be sent.");
                });
            };
            reader.onerror = () => status.text("The recording could not be prepared to send.");
            reader.readAsDataURL(recordedBlob);
        };
        voiceRecordingStream = recordingStream;
        recorder.start(1000);
        button.addClass("recording")
            .attr({ "aria-label": "Stop recording", title: "Stop recording" });
        status.text("Recording 0:00 — select the microphone again to send.");
        voiceRecordingTimer = window.setInterval(() => {
            const seconds = Math.floor((Date.now() - voiceRecordingStartedAt) / 1000);
            const minutes = Math.floor(seconds / 60);
            const remainder = String(seconds % 60).padStart(2, "0");
            status.text(`Recording ${minutes}:${remainder} — select the microphone to send.`);
            if (seconds >= MAX_VOICE_NOTE_SECONDS && recorder.state === "recording") {
                recorder.stop();
            }
        }, 1000);
    } catch (error) {
        if (recordingStream) {
            recordingStream.getTracks().forEach((track) => track.stop());
        }
        voiceRecordingStream = null;
        voiceRecorder = null;
        status.text(error.message || "Could not access the microphone.");
    }
}

$("#start-audio-call").on("click", () => startCall("audio"));
$("#start-video-call").on("click", () => startCall("video"));
$("#answer-call").on("click", acceptIncomingCall);
$("#decline-call").on("click", declineIncomingCall);
$("#end-call").on("click", () => finishCall(true));
$("#record-voice-note").on("click", startVoiceNote);

socket.on("call:ring", (invitation) => {
    if (invitation.caller.id === currentUserId) return;
    if (activeCall || incomingCall) {
        socket.emit("call:decline", { callId: invitation.callId });
        return;
    }

    incomingCall = {
        ...invitation,
        chat: invitation.chatType === "group"
            ? { type: "group", id: String(invitation.chatId) }
            : { type: "direct", contactNo: invitation.caller.contactNo },
    };
    showCallPanel(`${invitation.caller.name} is calling (${invitation.mode}).`, true);
});
socket.on("call:participant-joined", ({ callId, user }) => {
    if (activeCall && activeCall.callId === callId) {
        if (activeCall.timeout) {
            window.clearTimeout(activeCall.timeout);
            activeCall.timeout = null;
        }
        createCallPeer(user, true);
    }
});
socket.on("call:signal", handleCallSignal);
socket.on("call:participant-left", ({ callId, userId }) => {
    if (!activeCall || activeCall.callId !== callId) return;
    const peer = activeCall.peers.get(String(userId));
    if (peer) {
        peer.connection.close();
        peer.tile.remove();
        activeCall.peers.delete(String(userId));
    }
});
socket.on("call:declined", ({ callId, user }) => {
    if (activeCall && activeCall.callId === callId) {
        $("#call-status").text(`${user.name} declined the call.`);
    }
});
socket.on("call:ended", ({ callId, reason }) => {
    const wasActiveCall = activeCall && activeCall.callId === callId;
    if (wasActiveCall) finishCall(false);
    if (incomingCall && incomingCall.callId === callId) {
        incomingCall = null;
        $("#call-panel").prop("hidden", true);
    }
    if (wasActiveCall && reason === "declined") showCallNotice("The call was declined.");
});
socket.on("call:error", ({ message }) => {
    if (message) $("#call-status").text(message);
});
socket.on("disconnect", () => {
    if (activeCall) finishCall(false);
    incomingCall = null;
    $("#call-panel").prop("hidden", true);
});

function applyPresence(contactNo, status) {
    const normalizedStatus = ["online", "away", "offline"].includes(status)
        ? status
        : "offline";
    $("#contacts .contact").filter(function () {
        return this.dataset.contactNo === String(contactNo);
    }).find(".contact-status")
        .removeClass("online away busy offline")
        .addClass(normalizedStatus);

    if (String(contactNo) === currentContactNo) {
        $("#profile-img")
            .removeClass("online away busy offline")
            .addClass(normalizedStatus);
        $("#status-options li").removeClass("active");
        $(`#status-${normalizedStatus}`).addClass("active");
    }
}

function setPresence(status) {
    socket.emit("set-presence", status, (result) => {
        if (!result || !result.ok) {
            window.alert(result && result.message
                ? result.message
                : "Your presence could not be updated.");
            return;
        }
        applyPresence(currentContactNo, result.status);
    });
}

function renderSearchResults(results, query) {
    const list = $("#search-results").empty();
    if (!query) {
        list.hide();
        return;
    }

    list.show();
    if (results.length === 0) {
        list.append($("<li>").addClass("search-empty").text("No matches found."));
        return;
    }

    results.forEach((result) => {
        const item = $("<li>");
        const button = $("<button>")
            .attr("type", "button")
            .addClass("search-result")
            .data("result", result);
        const title = $("<span>").addClass("search-result-name").text(result.conversationName);
        const details = result.message
            ? result.message
            : result.chatType === "group" ? "Private group" : "Conversation";
        button.append(title, $("<span>").addClass("search-result-preview").text(details));
        item.append(button).appendTo(list);
    });
}

async function searchChats(query) {
    if (searchRequest) searchRequest.abort();
    searchRequest = $.ajax({
        url: "/search",
        method: "GET",
        data: { q: query },
        dataType: "json",
    }).done((response) => {
        renderSearchResults(response.results, query);
    }).fail((xhr, status) => {
        if (status === "abort") return;
        console.error("Chat search failed:", xhr.status);
        renderSearchResults([], query);
        $("#search-results .search-empty").text("Search is unavailable. Please try again.");
    });
}

$("#chat-search").on("input", function () {
    const query = this.value.trim();
    const normalizedQuery = query.toLocaleLowerCase();
    $("#contacts > ul > .contact").each(function () {
        const name = $(this).find(".name").text().toLocaleLowerCase();
        $(this).toggle(!normalizedQuery || name.includes(normalizedQuery));
    });
    $("#group-list > .group-contact").each(function () {
        const name = $(this).find(".name").text().toLocaleLowerCase();
        $(this).toggle(!normalizedQuery || name.includes(normalizedQuery));
    });

    window.clearTimeout(searchTimer);
    if (!query) {
        if (searchRequest) searchRequest.abort();
        renderSearchResults([], "");
        return;
    }
    if (query.length > 80) {
        renderSearchResults([], query);
        $("#search-results .search-empty").text("Search terms must be 80 characters or fewer.");
        return;
    }
    searchTimer = window.setTimeout(() => searchChats(query), 250);
});

$("#search-results").on("click", ".search-result", function () {
    const result = $(this).data("result");
    if (result.chatType === "group") {
        showGroupInMainPanel({
            id: result.conversationId,
            name: result.conversationName,
        });
    } else {
        showUserInMainPanel({
            contactNo: result.contactNo,
            name: result.conversationName,
            img: result.img,
        });
    }
    $("#chat-search").val("");
    $("#chat-search").trigger("input");
});

socket.on("presence-update", ({ contactNo, status }) => {
    applyPresence(contactNo, status);
});
socket.on("presence-error", (message) => window.alert(message));

socket.on("profile-picture-updated", ({ contactNo, img }) => {
    window.profilePicturesByContact[contactNo] = img;

    $("#profile-img").filter(function () {
        return currentContactNo === String(contactNo);
    }).attr("src", img);

    $("#contacts .contact").filter(function () {
        return this.dataset.contactNo === String(contactNo);
    }).find(".wrap > img").attr("src", img);

    if (activeChat && activeChat.type === "direct" &&
        activeChat.contactNo === String(contactNo)) {
        $(".contact-profile > img").attr("src", img);
    }

    $(".messages li[data-from-contact]").filter(function () {
        return this.dataset.fromContact === String(contactNo);
    }).find("img").first().attr("src", img);
});

function logout() {
    window.location.href = `${window.location.origin}/logout`;
}

function selectFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => sendMessage(loadEvent.target.result);
    reader.readAsDataURL(file);
    event.target.value = "";
}

$("#group-list").on("click keydown", ".group-contact", function (event) {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") {
        return;
    }
    event.preventDefault();
    showGroupInMainPanel({
        id: this.dataset.groupId,
        name: this.dataset.groupName,
    });
});

$(".submit").on("click", () => sendMessage(null));
$(".message-input input").on("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        sendMessage(null);
    }
});
socket.on("receive-message", receiveMessage);
socket.on("message-error", (message) => window.alert(message));
