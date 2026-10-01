const socket = io();

socket.on('connect', () => {
	const from = $("#sidepanel #profile #expanded input").val();
	socket.emit('addPhoneNumber', from);
});

var docHeight = $(document).height();

function loadChats() {
    const from = $("#sidepanel #profile #expanded input").val();
    let to = $(".contact-profile .small.text.d-block").text();

    socket.emit('load-message', {from, to}, (data) => {
        for (chat of data) {
            let formattedTime = moment(chat.datetime).format('hh:mm A');

            if (from == chat.from) {
                if (chat.type === "image") {
                    displayImageMessage('replies', chat.img, chat.message);
                } else {
                    displayMessage('replies', chat.img, chat.message, formattedTime);
                    $('#contacts .contact .wrap .meta #' + chat.to).html('<span>You: </span>' + chat.message);
                }
            } else {
                if (chat.type === "image") {
                    displayImageMessage('sent', chat.img, chat.message);
                } else {
                    displayMessage('sent', chat.img, chat.message, formattedTime);
                    $(`#${chat.from}`).html('<span></span>' + chat.message);
                }
            }
            docHeight += 93
        }

        $(".messages").animate({ scrollTop: docHeight }, "fast");
    });
}

function displayMessage (mode,imgSrc, message, time) {
    let newMessage = $(
        `<li class="${mode}">
            <img src="${imgSrc}" alt="" />
            <p>${message}
                <span class="float-right small text ml-2">${time}</span>
            </p>
        </li>`
    );
    // Append the new message to the messages list
    newMessage.appendTo($('.messages ul'));
}

function displayImageMessage(mode, userImg, imageUrl) {
    var messageContainer = $(".messages ul");

    var messageHtml = `
        <li class="${mode}">
            <img src="${userImg}" alt="" />
            <img src="${imageUrl}" alt="" class="message-image" />
        </li>
    `;
    messageContainer.append(messageHtml);
}

function sendMessage(imageData) {
    let message = $(".message-input input").val();
    let sendTo = $(".contact-profile .small.text.d-block").text();
    const from = $("#sidepanel #profile #expanded input").val();
    let img = $("#profile-img").attr("src");
    let data;
    
	if($.trim(sendTo) == '') {
        sendTo = "room-"+$(".contact-profile .name.mt-2").text();
	}
    
	if($.trim(message) == '' && imageData === null) {
        return false;
	}

    if (imageData === null) {
        data = {
            "from": from,
            "to": sendTo,
            "img": img,
            "type": "text",
            "message": message,
            datetime: new Date()
        }
    } else {
        data = {
            "from": from,
            "to": sendTo,
            "img": img,
            "type": "image",
            "message": imageData,
            datetime: new Date()
        }
    }

    socket.emit("send-message", data)

    if (imageData === null) displayMessage('replies', img, data.message, moment(data.datetime).format('hh:mm A'));

	$('.message-input input').val(null);
	
    if (data.to && !data.to.startsWith("room-")) {
		$('#contacts .contact .wrap .meta #'+data.to).html('<span>You: </span>' + data.message);
	}
    docHeight += 93
    $(".messages").animate({ scrollTop: docHeight }, "fast");
};

function receiveMessage(data) {
    let imgSrc = data.img
    let formattedTime = moment(data.datetime).format('hh:mm A');
	let check = $(".contact-profile .small.text.d-block").text();
    
    if(check === data.from || data.to.startsWith("room-")) {
        if (data.type === "image") {
            displayImageMessage('sent', imgSrc , data.message)
        } else {
            displayMessage('sent', imgSrc, data.message, formattedTime);
        }
	}

	if (data.to && !data.to.startsWith("room-") && data.type === 'text') {
		$(`#${data.from}`).html('<span></span>' + data.message);
	}
    docHeight += 93
    $(".messages").animate({ scrollTop: docHeight }, "fast");
};

$("#joinroom").on('click', () => {
    const roomName = prompt("Enter Room name:")
    if ($.trim(roomName) == '') {
        return false;
    }

    toggleSelectChatMessage(false)

    $(".contact-profile img").attr("src", "https://png.pngtree.com/png-clipart/20190921/original/pngtree-group-chat-icon-png-image_4763828.jpg");
    $(".contact-profile p .name").text(roomName).addClass("mt-2");
    $(".contact-profile p .small.text.d-block.mt-3").text('') // Hide the phone number
    $(".messages ul").empty();

    socket.emit('join-room', roomName)
});

$('.submit').click(function() {
    sendMessage(null);
});

$(window).on('keydown', function(e) {
  if (e.which == 13) {
    sendMessage(null);
    return false;
  }
});

socket.on('receive-message', (data) => receiveMessage(data))
