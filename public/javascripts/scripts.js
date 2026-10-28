$(".messages").animate({ scrollTop: $(document).height() }, "fast");

window.profilePicturesByContact = Object.create(null);

$("#profile-img").click(function () {
    $("#status-options").toggleClass("active");
});

$(".expand-button").click(function () {
    $("#profile").toggleClass("expanded");
    $("#contacts").toggleClass("expanded");
});

$("#status-options ul li").click(function () {
    if (typeof setPresence === "function") {
        setPresence(this.id === "status-away" ? "away" : "online");
    }
    $("#status-options").removeClass("active");
});

function toggleSelectChatMessage(show) {
    $("#frame").toggleClass("chat-open", !show);
    if (show) {
        $("#selectChatMessage").show();
        $(".contact-profile").hide();
        $(".messages").hide();
        $(".message-input").hide();
    } else {
        $("#selectChatMessage").hide();
        $(".contact-profile").show();
        $(".messages").show();
        $(".message-input").show();
    }
}

toggleSelectChatMessage(true);
$("#back-to-chats").on("click", () => toggleSelectChatMessage(true));

$(document).ready(function () {
    $(document).keyup(function (e) {
        if (e.key === "Escape") {
            toggleSelectChatMessage(true);
        }
    });
});

function showUserInMainPanel(user) {
    toggleSelectChatMessage(false);
    if (user) {
        $(".contact-profile img").attr("src", user.img);
        $(".contact-profile p .name").text(user.name);
        $(".contact-profile p .small.text.d-block.mt-3").text(user.contactNo);
        $(".messages ul").empty();
        $(".messages ul").append(
            '<li class="sent"><img src="' +
                user.img +
                '" alt="" /><p>' +
                user.preview +
                "</p></li>"
        );
        loadChats();
    }
}

function logout() {
    // Get the current base URL
    const baseURL = window.location.origin;

    // Construct the logout URL by appending the logout path
    const logoutURL = `${baseURL}/logout`;

    // Redirect to the logout URL
    window.location.href = logoutURL;
}

function selectFile(e) {
    const fileInput = e.target;
	const userImage = $("#profile-img").attr("src");
    const file = fileInput.files[0];
    if (file) {
		const reader = new FileReader();
        reader.onload = function (e) {
			const imageData = e.target.result;
			sendMessage(imageData)
			displayImageMessage('replies', userImage , imageData)
        };
        reader.readAsDataURL(file);
    }
}

$("#profilePicture").on("change", async function () {
    const file = this.files[0];
    if (!file) return;

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