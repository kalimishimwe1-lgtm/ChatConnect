const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    contactNo: { type: String, required: true, unique: true },
    img: { type: String, required: true },
    status: { type: String, default: "offline" },
    preview: { type: String },
    Password: { type: String, required: true },
});

const chatSchema = new mongoose.Schema({
    from: { type: String, required: true },
    to: { type: String, required: true },
    img: { type: String, required: true },
    type: {type: String, required: true, default:"text"},
    message: { type: String, required: true },
    datetime: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Chat = mongoose.model("Chat", chatSchema);

module.exports = { User, Chat };