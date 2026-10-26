const socket = io();
const currentContactNo = $("#sidepanel #profile #expanded input").val();
let activeChat = null;
let docHeight = $(document).height();
const displayedMessageIds = new Set();

function scrollToLatestMessage() {
    $(".messages").animate({ scrollTop: docHeight }, "fast");
}

function displayMessage(mode, imgSrc, message, time) {
    const item = $("<li>").addClass(mode);
    const avatar = $("<img>").attr("src", imgSrc || "").attr("alt", "");
    const content = $("<p>").text(message);
    const timestamp = $("<span>")
        .addClass("float-right small text ml-2")
        .text(time);

    content.append(timestamp);
    item.append(avatar, content).appendTo($(".messages ul"));
    docHeight += 93;
}

function displayImageMessage(mode, userImg, imageUrl) {
    const item = $("<li>").addClass(mode);
    item.append(
        $("<img>").attr("src", userImg || "").attr("alt", ""),
        $("<img>")
            .attr("src", imageUrl)
            .attr("alt", "Shared image")
            .addClass("message-image")
    );
    item.appendTo($(".messages ul"));
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
    if (message.type === "image") {
        displayImageMessage(mode, message.img, message.message);
    } else {
        displayMessage(mode, message.img, message.message, formattedTime);
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
    toggleSelectChatMessage(false);
    $(".contact-profile").removeClass("group-chat");
    $(".contact-profile img").attr("src", user.img || "");
    $(".contact-profile .name").text(user.name);
    $(".contact-profile .small.text.d-block").text(user.contactNo);
    $(".messages ul").empty();
    displayedMessageIds.clear();
    docHeight = 0;
    loadChats();
}

function showGroupInMainPanel(group) {
    activeChat = { type: "group", id: String(group.id), name: group.name };
    toggleSelectChatMessage(false);
    $(".contact-profile").addClass("group-chat");
    $(".contact-profile .name").text(group.name);
    $(".contact-profile .small.text.d-block").text("Private group");
    $(".messages ul").empty();
    displayedMessageIds.clear();
    docHeight = 0;
    loadChats();
}

function sendMessage(imageData) {
    if (!activeChat) return false;

    const input = $(".message-input input");
    const text = input.val();
    const message = imageData === null ? text : imageData;
    if (!message || (imageData === null && !$.trim(message))) return false;

    const data = {
        type: imageData === null ? "text" : "image",
        message,
    };
    if (activeChat.type === "group") {
        data.groupId = activeChat.id;
    } else {
        data.to = activeChat.contactNo;
    }
    const sentChat = { ...activeChat };

    socket.emit("send-message", data, (result) => {
        if (!result || !result.ok) {
            if (imageData === null && !input.val()) input.val(text);
            window.alert(result && result.message
                ? result.message
                : "The message could not be sent.");
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
    });

    if (imageData === null) input.val(null);
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
