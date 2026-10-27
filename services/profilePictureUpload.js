const multer = require("multer");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 10, parts: 11 },
});

const imageSignatures = {
    "image/jpeg": (buffer) => buffer.length >= 3 &&
        buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    "image/png": (buffer) => buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    ),
    "image/gif": (buffer) => {
        const signature = buffer.subarray(0, 6).toString("ascii");
        return signature === "GIF87a" || signature === "GIF89a";
    },
    "image/webp": (buffer) => buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP",
};

const profilePictureUpload = (req, res, next) => {
    upload.single("profilePicture")(req, res, (error) => {
        if (error) {
            if (error.code === "LIMIT_FILE_SIZE") {
                error.statusCode = 413;
                error.message = "Profile pictures must be 2 MB or smaller.";
            } else {
                error.statusCode = 400;
            }
            req.profilePictureError = error;
            return next();
        }

        if (!req.file) {
            return next();
        }

        const matchesSignature = Object.hasOwn(imageSignatures, req.file.mimetype)
            ? imageSignatures[req.file.mimetype]
            : null;
        if (!matchesSignature || !matchesSignature(req.file.buffer)) {
            const invalidImageError = new Error("Upload a valid JPEG, PNG, GIF, or WebP image.");
            invalidImageError.statusCode = 400;
            req.profilePictureError = invalidImageError;
            return next();
        }

        req.profilePicture = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
        return next();
    });
};

module.exports = { profilePictureUpload };
