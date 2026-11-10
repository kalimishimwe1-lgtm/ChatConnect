$(".messages").animate({ scrollTop: $(document).height() }, "fast");

$("#profile-img").click(function () {
    $("#status-options").toggleClass("active");
});

$(".expand-button").click(function () {
    $("#profile").toggleClass("expanded");
    $("#contacts").toggleClass("expanded");
});

$("#status-options ul li").click(function () {
    $("#profile-img").removeClass();
    $("#status-online").removeClass("active");
    $("#status-away").removeClass("active");
    $("#status-busy").removeClass("active");
    $("#status-offline").removeClass("active");
    $(this).addClass("active");

    if ($("#status-online").hasClass("active")) {
        $("#profile-img").addClass("online");
    } else if ($("#status-away").hasClass("active")) {
        $("#profile-img").addClass("away");
    } else if ($("#status-busy").hasClass("active")) {
        $("#profile-img").addClass("busy");
    } else if ($("#status-offline").hasClass("active")) {
        $("#profile-img").addClass("offline");
    } else {
        $("#profile-img").removeClass();
    }

    $("#status-options").removeClass("active");
});

function toggleSelectChatMessage(show) {
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