const socket = io()

io.emit("send-message", message)

io.on('receive-message', (message) => {
    receiveMessage("hola")
    console.log("hols")
})