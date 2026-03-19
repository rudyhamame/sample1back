import nodemailer from "nodemailer";

const buildTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "Missing SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM."
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: {
      user,
      pass,
    },
  });
};

export const sendSignupVerificationEmail = async ({ email, firstname, code }) => {
  const fromName = process.env.SMTP_FROM;
  const smtpUser = process.env.SMTP_USER;
  const from =
    fromName && fromName.includes("@")
      ? fromName
      : fromName && smtpUser
        ? `"${fromName.replace(/"/g, "")}" <${smtpUser}>`
        : smtpUser;

  if (!from) {
    throw new Error("Missing SMTP_FROM configuration.");
  }

  const transporter = buildTransporter();

  await transporter.sendMail({
    from,
    to: email,
    subject: "Your verification code for H | MCTOS",
    text: [
      `Hello Dr. ${firstname},`,
      "",
      "Use the verification code below to complete your signup:",
      "",
      code,
      "",
      "This code expires in 10 minutes.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
        <p>Hello Dr. ${firstname},</p>
        <p>Use the verification code below to complete your signup:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${code}</p>
        <p>This code expires in 10 minutes.</p>
      </div>
    `,
  });
};
