import mongoose from "mongoose";

const Schema = mongoose.Schema;

const SignupVerificationSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    firstname: {
      type: String,
      required: true,
    },
    lastname: {
      type: String,
      required: true,
    },
    dob: {
      type: Date,
      required: false,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    verificationCode: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  }
);

const SignupVerificationModel = mongoose.model(
  "signupVerification",
  SignupVerificationSchema
);

export default SignupVerificationModel;
