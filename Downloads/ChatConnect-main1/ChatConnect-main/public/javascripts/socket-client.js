const socket = io();
let typingTimer = null;
let lastDayStamp = "";
const messageStatuses = new Map();
const statusRank = { sent: 0, delivered: 1, read: 2 };

socket.on("connect", () => {
    const from = getMyNumber();
    socket.emit("addPhoneNumber", from);
});

function renderOwnPresence(status) {
    const presence = status === "away" ? "away" : status === "offline" ? "offline" : "online";
    $("#profile-img").removeClass("online away offline").addClass(presence);
    $("#status-options li").removeClass("active");
    $(`#status-${presence}`).addClass("active");
}

function setPresence(status) {
    socket.emit("set-presence", status, (result) => {
        if (!result || !result.ok) {
            window.alert(result && result.message
                ? result.message
                : "Your presence could not be updated.");
            return;
        }
        renderOwnPresence(result.status);
    });
}

function ticksMarkup(status) {
    if (!status) {
        return "";
    }
    const cls = status === "read" ? "ticks read" : status === "delivered" ? "ticks delivered" : "ticks";
    const mark = status === "sent" ? "✓" : "✓✓";
    return `<span class="${cls}" data-ticks="${status}">${mark}</span>`;
}

function getMessageStatus(id, fallback) {
    if (id === undefined || id === null) {
        return fallback || "sent";
    }
    const current = messageStatuses.get(String(id));
    if (!current || (statusRank[fallback] || 0) > (statusRank[current] || 0)) {
        return fallback || current || "sent";
    }
    return current;
}

function applyMessageStatus(id, status) {
    const messageId = String(id);
    const current = messageStatuses.get(messageId);
    if (current && (statusRank[current] || 0) > (statusRank[status] || 0)) {
        status = current;
    }
    messageStatuses.set(messageId, status);
    if (messageStatuses.size > 5000) {
        messageStatuses.delete(messageStatuses.keys().next().value);
    }

    $(".messages li[data-message-id]").each(function () {
        if (this.dataset.messageId !== messageId) {
            return;
        }
        const ticks = $(this).find(".ticks");
        ticks.attr("data-ticks", status)
            .toggleClass("delivered", status === "delivered")
            .toggleClass("read", status === "read")
            .text(status === "sent" ? "✓" : "✓✓");
    });
}

function maybeDaySeparator(datetime) {
    const stamp = moment(datetime).format("YYYY-MM-DD");
    if (stamp === lastDayStamp) {
        return "";
    }
    lastDayStamp = stamp;
    const label = moment(datetime).calendar(null, {
        sameDay: "[Today]",
        lastDay: "[Yesterday]",
        lastWeek: "dddd",
        sameElse: "D MMMM YYYY",
    });
    return `<li class="day-sep"><span>${label}</span></li>`;
}

function scrollMessages() {
    const pane = $(".messages");
    pane.scrollTop(pane.prop("scrollHeight"));
}

function loadChats() {
    const from = getMyNumber();
    const to = $(".contact-profile .chat-phone").text();
    const requestedChat = window.activeChat;
    const isGroup = typeof requestedChat === "string" && requestedChat.startsWith("group:");
    const details = isGroup
        ? { groupId: requestedChat.slice("group:".length) }
        : { from, to };
    lastDayStamp = "";

    socket.emit("load-message", details, (data) => {
        if (window.activeChat !== requestedChat || !Array.isArray(data)) {
            return;
        }
        $(".messages ul").empty();
        lastDayStamp = "";
        for (const chat of data) {
            const formattedTime = moment(chat.datetime).format("HH:mm");
            const mine = from == chat.from;
            const mode = mine ? "outgoing" : "incoming";
            if (chat.type === "image") {
                displayImageMessage(mode, chat.img, chat.message, chat.from, {
                    time: formattedTime,
                    id: chat.id,
                    ticks: mine && !isGroup ? getMessageStatus(chat.id, chat.status) : false,
                    author: !mine && isGroup ? chat.fromName : "",
                    datetime: chat.datetime,
                });
            } else {
                displayMessage(mode, chat.img, chat.message, formattedTime, chat.from, {
                    id: chat.id,
                    ticks: mine && !isGroup ? getMessageStatus(chat.id, chat.status) : false,
                    author: !mine && isGroup ? chat.fromName : "",
                    datetime: chat.datetime,
                });
            }
        }
        scrollMessages();
        if (!isGroup) {
            socket.emit("messages-read", { to });
        }
    });
}

function displayMessage(mode, imgSrc, message, time, fromContact, extra) {
    extra = extra || {};
    const sep = maybeDaySeparator(extra.datetime || new Date());
    if (sep) {
        $(sep).appendTo($(".messages ul"));
    }
    const ticks = mode === "outgoing"
        ? (extra.ticks === false ? "" : ticksMarkup(getMessageStatus(extra.id, extra.ticks || "sent")))
        : "";
    const newMessage = $("<li>").addClass(mode);
    const content = $("<p>").text(message == null ? "" : String(message));
    const metadata = $("<span>")
        .addClass("msg-meta")
        .append($("<span>").addClass("time").text(time == null ? "" : String(time)));
    if (ticks) {
        metadata.append($(ticks));
    }
    newMessage.append(
        $("<img>").attr("src", imgSrc || "").attr("alt", ""),
        content.append(metadata)
    );
    newMessage.attr("data-from-contact", fromContact || "");
    if (extra.id !== undefined) {
        newMessage.attr("data-message-id", String(extra.id));
    }
    if (extra.author) {
        newMessage.find("p").prepend($("<br>")).prepend(
            $("<span>").addClass("message-author").text(extra.author)
        );
    }
    newMessage.appendTo($(".messages ul"));
}

function displayImageMessage(mode, userImg, imageUrl, fromContact, extra) {
    extra = extra || {};
    const sep = maybeDaySeparator(extra.datetime || new Date());
    if (sep) {
        $(sep).appendTo($(".messages ul"));
    }
    const ticks = mode === "outgoing"
        ? (extra.ticks === false ? "" : ticksMarkup(getMessageStatus(extra.id, extra.ticks || "sent")))
        : "";
    const time = extra.time || moment().format("HH:mm");
    const messageHtml = $("<li>").addClass(mode);
    const bubble = $("<div>").addClass("bubble");
    const metadata = $("<span>")
        .addClass("msg-meta")
        .append($("<span>").addClass("time").text(time));
    if (ticks) {
        metadata.append($(ticks));
    }
    bubble.append(
        $("<img>").attr("src", imageUrl || "").attr("alt", "Shared image").addClass("message-image"),
        metadata
    );
    messageHtml.append(
        $("<img>").attr("src", userImg || "").attr("alt", ""),
        bubble
    );
    messageHtml.attr("data-from-contact", fromContact || "");
    if (extra.id !== undefined) {
        messageHtml.attr("data-message-id", String(extra.id));
    }
    if (extra.author) {
        messageHtml.find(".bubble").prepend(
            $("<span>").addClass("message-author").text(extra.author)
        );
    }
    $(".messages ul").append(messageHtml);
}

function sendMessage(imageData) {
    const message = $(".message-input input").val();
    let sendTo = $(".contact-profile .chat-phone").text();
    const from = getMyNumber();
    const img = $("#profile-img").attr("src");
    const targetChat = window.activeChat;
    const isGroup = typeof targetChat === "string" && targetChat.startsWith("group:");
    let data;

    if ((!sendTo && !isGroup) || ($.trim(message) == "" && imageData === null)) {
        return false;
    }

    if (isGroup) {
        data = {
            groupId: targetChat.slice("group:".length),
            type: imageData === null ? "text" : "image",
            message: imageData === null ? message : imageData,
        };
    } else if (imageData === null) {
        data = {
            from: from,
            to: sendTo,
            img: img,
            type: "text",
            message: message,
            datetime: new Date().toISOString(),
        };
    } else {
        data = {
            from: from,
            to: sendTo,
            img: img,
            type: "image",
            message: imageData,
            datetime: new Date().toISOString(),
        };
    }

    if (!isGroup) {
        socket.emit("typing", { from, to: sendTo, isTyping: false });
    }

    socket.emit("send-message", data, (result) => {
        if (!result || !result.ok) {
            if (imageData === null && !$(".message-input input").val()) {
                $(".message-input input").val(message);
            }
            window.alert(result && result.message
                ? result.message
                : "The message could not be sent.");
            return;
        }

        const savedMessage = result.message;
        const sameChat = isGroup
            ? window.activeChat === `group:${savedMessage.groupId}`
            : window.activeChat === String(sendTo);
        if (sameChat) {
            if (savedMessage.type === "image") {
                displayImageMessage("outgoing", img, savedMessage.message, from, {
                    id: savedMessage.id,
                    ticks: isGroup ? false : savedMessage.status,
                    time: moment(savedMessage.datetime).format("HH:mm"),
                    datetime: savedMessage.datetime,
                });
            } else {
                displayMessage("outgoing", img, savedMessage.message, moment(savedMessage.datetime).format("HH:mm"), from, {
                    id: savedMessage.id,
                    ticks: isGroup ? false : savedMessage.status,
                    datetime: savedMessage.datetime,
                });
            }
            scrollMessages();
        }

        if (imageData === null && $(".message-input input").val() === message) {
            $(".message-input input").val(null);
        }
        if (!isGroup) {
            const previewText = savedMessage.type === "image" ? "Photo" : savedMessage.message;
            updateContactPreview(sendTo, previewText, true);
        }
    });
}

function receiveMessage(data) {
    if (String(data.from) === String(getMyNumber())) {
        return;
    }
    const imgSrc = data.img;
    const formattedTime = moment(data.datetime).format("HH:mm");
    const isGroup = data.groupId !== undefined;
    const currentChat = window.activeChat;
    const from = getMyNumber();
    const inThisChat = isGroup
        ? currentChat === `group:${data.groupId}`
        : currentChat === String(data.from) && String(data.to) === String(from);

    if (inThisChat) {
        if (data.type === "image") {
            displayImageMessage("incoming", imgSrc, data.message, data.from, {
                id: data.id,
                author: isGroup ? data.fromName : "",
                time: formattedTime,
                datetime: data.datetime,
            });
        } else {
            displayMessage("incoming", imgSrc, data.message, formattedTime, data.from, {
                id: data.id,
                author: isGroup ? data.fromName : "",
                datetime: data.datetime,
            });
        }
        if (!isGroup) {
            socket.emit("messages-read", { to: data.from });
        }
        $("#typing-indicator").attr("hidden", true);
    } else if (isGroup) {
        bumpGroupUnread(data.groupId);
    } else {
        bumpUnread(data.from);
    }

    if (!isGroup) {
        const previewText = data.type === "image" ? "Photo" : data.message;
        updateContactPreview(data.from, previewText, false);
    }
    scrollMessages();
}

function openGroupChat() {
    const form = $("#create-group-details");
    if (!form.length) {
        return;
    }

    form.prop("open", true);
    $("#group-name").trigger("focus");
}

$("#joinroom, #new-chat-btn, #new-group-action").on("click", openGroupChat);

$(".submit").click(function () {
    sendMessage(null);
});

$(window).on("keydown", function (e) {
    if (e.which == 13 && $(e.target).is("#message-box, .message-input input")) {
        sendMessage(null);
        return false;
    }
});

$(".message-input input").on("input", function () {
    const to = $(".contact-profile .chat-phone").text();
    const from = getMyNumber();
    if (!to) {
        return;
    }
    socket.emit("typing", { from, to, isTyping: true });
    window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => {
        socket.emit("typing", { from, to, isTyping: false });
    }, 1200);
});

socket.on("receive-message", (data) => receiveMessage(data));

socket.on("presence-snapshot", (snapshot) => {
    window.presence.online = new Set(snapshot.online || []);
    window.presence.lastSeen = snapshot.lastSeen || {};
    window.presence.online.forEach((contactNo) => setContactOnline(contactNo, true));
});

socket.on("presence-update", ({ contactNo, status, lastSeen }) => {
    if (String(contactNo) === String(getMyNumber())) {
        renderOwnPresence(status);
    }
    if (status === "online") {
        window.presence.online.add(String(contactNo));
        setContactOnline(contactNo, true);
    } else {
        window.presence.online.delete(String(contactNo));
        if (lastSeen) {
            window.presence.lastSeen[contactNo] = lastSeen;
        }
        setContactOnline(contactNo, false);
    }
});

socket.on("typing", ({ from, isTyping }) => {
    if (window.activeChat !== String(from)) {
        return;
    }
    $("#typing-indicator").attr("hidden", !isTyping);
    $(".chat-presence").text(isTyping ? "typing..." : "online");
    if (!isTyping) {
        updatePresenceLabel(from);
    }
    scrollMessages();
});

socket.on("message-status", ({ ids, status }) => {
    if (!Array.isArray(ids) || !["sent", "delivered", "read"].includes(status)) {
        return;
    }
    for (const id of ids) {
        applyMessageStatus(id, status);
    }
});

socket.on("profile-picture-updated", ({ contactNo, img }) => {
    window.profilePicturesByContact[contactNo] = img;

    $("#contacts .contact").each(function () {
        if (this.dataset.contactNo === contactNo) {
            $(this).find(".wrap > img").attr("src", img);
        }
    });

    if ($(".contact-profile .chat-phone").text() === contactNo) {
        $(".contact-profile > img").attr("src", img);
    }

    $(".messages li[data-from-contact]").each(function () {
        if (this.dataset.fromContact === contactNo) {
            $(this).find("img").first().attr("src", img);
        }
    });
});

const EMOJIS = ["😀","😁","😂","🤣","😊","😍","😘","😎","😢","😭","😡","👍","👎","🙏","🔥","❤️","🎉","😅","🤔","👏","💯","😴","🤗","👌"];
const picker = $("#emoji-picker");
EMOJIS.forEach((emoji) => {
    picker.append($("<button>", { type: "button", text: emoji }));
});

$("#emoji-toggle").on("click", function () {
    picker.prop("hidden", !picker.prop("hidden"));
});

picker.on("click", "button", function () {
    const input = $(".message-input input");
    input.val(input.val() + $(this).text());
    input.trigger("input").focus();
});
