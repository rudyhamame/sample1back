import dns from "node:dns";
import nodemailer from "nodemailer";

const buildFromAddress = () => {
  const fromValue = process.env.EMAIL_FROM || process.env.SMTP_FROM;
  const smtpUser = process.env.SMTP_USER;

  if (fromValue && fromValue.includes("@")) {
    return fromValue;
  }

  if (fromValue && smtpUser) {
    return `"${fromValue.replace(/"/g, "")}" <${smtpUser}>`;
  }

  return smtpUser || "";
};

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
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: {
      servername: host,
    },
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { ...options, family: 4, all: false }, callback);
    },
    auth: {
      user,
      pass,
    },
  });
};

const sendWithResend = async ({ email, firstname, code, from }) => {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
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
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Resend email failed: ${response.status} ${errorText || response.statusText}`,
    );
  }

  return true;
};

export const sendSignupVerificationEmail = async ({ email, firstname, code }) => {
  const from = buildFromAddress();

  if (!from) {
    throw new Error(
      "Missing sender configuration. Set EMAIL_FROM or SMTP_FROM.",
    );
  }

  const sentWithResend = await sendWithResend({
    email,
    firstname,
    code,
    from,
  });

  if (sentWithResend) {
    return;
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
