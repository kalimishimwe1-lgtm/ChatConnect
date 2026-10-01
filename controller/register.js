const Server = require('../services/Server')
const sobj = new Server()

exports.register = async (data) => {
    try {
        const result = await sobj.getUserByContactNo(data.contactNo);

        if (result !== null)
            return {
                error: "Email is already associated with another account",
                hasError: true,
            };

        await sobj.createAccount(data);
        return { message: "Account created successfully", hasError: false };
    } catch (err) {
        console.error("Unexpected error during account creation:", err);
        throw { error: "Unexpected error occurred", hasError: true };
    }
};