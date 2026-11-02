$(".messages").animate({ scrollTop: $(document).height() }, "fast");

window.profilePicturesByContact = Object.create(null);
window.presence = { online: new Set(), lastSeen: {} };
window.activeChat = null;

$("#profile-img").click(function () {
    $("#status-options").toggleClass("active");
});

$(".expand-button").click(function () {
    $("#profile").toggleClass("expanded");
    $("#contacts").toggleClass("expanded");
});

$("#status-options ul li").click(function () {
    const status = this.id === "status-away" ? "away" : "online";
    if (typeof setPresence === "function") {
        setPresence(status);
    }
    $("#status-options").removeClass("active");
});

function toggleSelectChatMessage(show) {
    if (show) {
        $("#selectChatMessage").show();
        $(".contact-profile").hide();
        $(".messages").hide();
        $(".message-input").hide();
        $("#frame").removeClass("chat-open");
        window.activeChat = null;
        $(".contact.active").removeClass("active");
    } else {
        $("#selectChatMessage").hide();
        $(".contact-profile").show();
        $(".messages").show();
        $(".message-input").show();
        $("#frame").addClass("chat-open");
    }
}

toggleSelectChatMessage(true);

$(document).ready(function () {
    $(document).keyup(function (e) {
        if (e.key === "Escape") {
            toggleSelectChatMessage(true);
        }
    });
});

$("#back-to-chats").on("click", function () {
    toggleSelectChatMessage(true);
});

function showUserInMainPanel(user) {
    toggleSelectChatMessage(false);
    if (user) {
        $(".contact-profile").removeClass("group-chat");
        const userImage = window.profilePicturesByContact[user.contactNo] || user.img;
        window.activeChat = String(user.contactNo);
        $(".contact.active").removeClass("active");
        $(`#contacts .contact[data-contact-no="${user.contactNo}"]`).addClass("active");
        clearUnread(user.contactNo);
        $(".contact-profile img").attr("src", userImage);
        $(".contact-profile p .name").text(user.name).removeClass("mt-2");
        $(".contact-profile p .chat-phone").text(user.contactNo);
        updatePresenceLabel(user.contactNo);
        $(".messages ul").empty();
        if (typeof loadChats === "function") {
            loadChats();
        }
    }
}

function showGroupInMainPanel(groupId, groupName) {
    const id = String(groupId || "");
    if (!/^[1-9]\d*$/.test(id)) {
        return;
    }

    toggleSelectChatMessage(false);
    window.activeChat = `group:${id}`;
    $(".contact.active").removeClass("active");
    $(`#group-list .group-contact`).filter(function () {
        return this.dataset.groupId === id;
    }).addClass("active");
    clearGroupUnread(id);
    $(".contact-profile").addClass("group-chat");
    $(".contact-profile img").attr("src", "/images/default-profile.svg");
    $(".contact-profile p .name").text(groupName || "Private group").removeClass("mt-2");
    $(".contact-profile p .chat-phone").text("");
    $(".chat-presence").text("Private group");
    $(".messages ul").empty();
    $("#typing-indicator").attr("hidden", true);
    if (typeof loadChats === "function") {
        loadChats();
    }
}

$("#group-list").on("click", ".group-contact", function () {
    showGroupInMainPanel(this.dataset.groupId, this.dataset.groupName);
});

$("#group-list").on("keydown", ".group-contact", function (event) {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showGroupInMainPanel(this.dataset.groupId, this.dataset.groupName);
    }
});

function logout() {
    const baseURL = window.location.origin;
    const logoutURL = `${baseURL}/logout`;
    window.location.href = logoutURL;
}

function selectFile(e) {
    const fileInput = e.target;
    const file = fileInput.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (evt) {
            const imageData = evt.target.result;
            sendMessage(imageData);
        };
        reader.readAsDataURL(file);
        fileInput.value = "";
    }
}

$("#profilePicture").on("change", async function () {
    const file = this.files[0];
    if (!file) {
        return;
    }

    const profileImage = $("#profile-img");
    const previousImage = profileImage.attr("src");
    const previewUrl = URL.createObjectURL(file);
    const message = $("#profile-picture-message");
    profileImage.attr("src", previewUrl);
    message.text("Uploading profile picture...");

    try {
        const formData = new FormData($("#profile-picture-form")[0]);
        const response = await fetch("/profile-picture", { method: "POST", body: formData });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "The profile picture could not be updated.");
        }

        profileImage.attr("src", result.img);
        message.text("Profile picture updated.");
    } catch (error) {
        profileImage.attr("src", previousImage);
        message.text(error.message || "The profile picture could not be updated.");
    } finally {
        URL.revokeObjectURL(previewUrl);
        this.value = "";
    }
});

$("#chat-search").on("input", function () {
    const query = String($(this).val() || "").toLowerCase().trim();
    $("#contacts .contact").each(function () {
        const name = $(this).find(".name").text().toLowerCase();
        const number = String(this.dataset.contactNo || "").toLowerCase();
        const preview = $(this).find(".preview").text().toLowerCase();
        $(this).toggle(!query || name.includes(query) || number.includes(query) || preview.includes(query));
    });
});

function getMyNumber() {
    return $("#sidepanel #profile #expanded input").val();
}

function clearUnread(contactNo) {
    const row = $(`#contacts .contact[data-contact-no="${contactNo}"]`);
    row.removeClass("has-unread");
    row.find(".unread-badge").attr("hidden", true).text("0");
}

function clearGroupUnread(groupId) {
    const row = $("#group-list .group-contact").filter(function () {
        return this.dataset.groupId === String(groupId);
    });
    row.removeClass("has-unread");
    row.find(".unread-badge").attr("hidden", true).text("0");
}

function bumpUnread(contactNo) {
    if (window.activeChat === String(contactNo)) {
        return;
    }
    const row = $(`#contacts .contact[data-contact-no="${contactNo}"]`);
    const badge = row.find(".unread-badge");
    const next = Number(badge.text() || 0) + 1;
    badge.text(String(next)).removeAttr("hidden");
    row.addClass("has-unread");
}

function bumpGroupUnread(groupId) {
    if (window.activeChat === `group:${groupId}`) {
        return;
    }
    const row = $("#group-list .group-contact").filter(function () {
        return this.dataset.groupId === String(groupId);
    });
    const badge = row.find(".unread-badge");
    const next = Number(badge.text() || 0) + 1;
    badge.text(String(next)).removeAttr("hidden");
    row.addClass("has-unread");
}

function updateContactPreview(contactNo, text, fromMe) {
    const preview = fromMe ? "You: " + text : text;
    $(`#contacts .contact[data-contact-no="${contactNo}"] .preview`).text(preview);
    $(`#contacts .contact[data-contact-no="${contactNo}"] .chat-time`).text(moment().format("HH:mm"));
}

function updatePresenceLabel(contactNo) {
    const label = $(".chat-presence");
    if (!contactNo) {
        label.text("");
        return;
    }
    if (window.presence.online.has(String(contactNo))) {
        label.text("online");
        return;
    }
    const seen = window.presence.lastSeen[contactNo];
    if (seen) {
        label.text("last seen " + moment(seen).calendar());
        return;
    }
    label.text("click here for contact info");
}

function setContactOnline(contactNo, isOnline) {
    const dot = $(`#contacts .contact[data-contact-no="${contactNo}"] .contact-status`);
    dot.toggleClass("online", isOnline);
    if (window.activeChat === String(contactNo)) {
        updatePresenceLabel(contactNo);
    }
}
