const socket = io();
const currentContactNo = $("#sidepanel #profile #expanded input").val();
let activeChat = null;
let docHeight = $(document).height();
const displayedMessageIds = new Set();
let searchTimer = null;
let searchRequest = null;

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
