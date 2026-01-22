const nodemailer = require("nodemailer");


const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.RIFADBASIC_EMAIL,
    pass: process.env.RIFADBASIC_EMAIL_PASS, 
  },
});

module.exports = transporter;
