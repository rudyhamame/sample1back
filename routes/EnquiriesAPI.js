import express from "express";
import OpenAI from "openai";
import UserModel from "../models/Users.js";

const EnquiriesRouter = express.Router();

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const DEFAULT_INSTRUCTIONS =
  "You are a helpful assistant for MCTOSH. Answer website enquiries clearly, professionally, and concisely. If a question is missing details, say what information is needed.";
const DEFAULT_GREETING_INSTRUCTIONS =
  "You write one cheerful and professional sentence for a doctor dashboard. Mention the doctor's momentum based on the provided database summary. Keep it under 24 words. Do not use markdown, bullet points, or emojis.";

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
};

const buildUserSummary = (user) => {
  const courses = user.schoolPlanner?.courses?.length || 0;
  const lectures = user.schoolPlanner?.lectures?.length || 0;
  const terminology = user.terminology?.length || 0;
  const sessions = user.study_session?.length || 0;
  const friends = user.friends?.length || 0;
  const notifications = user.notifications?.length || 0;
  const posts = user.posts?.length || 0;
  const structureKeywords = user.study?.structure_keywords?.length || 0;
  const functionKeywords = user.study?.function_keywords?.length || 0;

  return {
    username: user.info?.username || "",
    firstname: user.info?.firstname || "",
    lastname: user.info?.lastname || "",
    counts: {
      friends,
      notifications,
      posts,
      terminology,
      sessions,
      courses,
      lectures,
      structureKeywords,
      functionKeywords,
    },
  };
};

const buildFallbackGreeting = (summary) => {
  const { username, counts } = summary;
  return `Dr. ${username}, your workspace is looking strong with ${counts.courses} courses, ${counts.lectures} lectures, and ${counts.terminology} saved medical terms ready for today.`;
};

const getGreetingErrorReply = (error, summary) => {
  const message = String(error?.message || "").toLowerCase();
  const status = error?.status;

  if (
    status === 429 ||
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("rate limit")
  ) {
    return "ChatGPT API has low balance.";
  }

  return buildFallbackGreeting(summary);
};

EnquiriesRouter.post("/", async function (req, res) {
  const client = getOpenAIClient();
  const message = req.body?.message?.trim();
  const context = req.body?.context?.trim();
  const instructions = req.body?.instructions?.trim() || DEFAULT_INSTRUCTIONS;

  if (!client) {
    return res.status(500).json({
      message: "Missing OPENAI_API_KEY in the backend environment.",
    });
  }

  if (!message) {
    return res.status(400).json({
      message: "message is required.",
    });
  }

  const prompt = context ? `Context:\n${context}\n\nEnquiry:\n${message}` : message;

  try {
    const response = await client.responses.create({
      model: DEFAULT_MODEL,
      instructions,
      input: prompt,
    });

    return res.status(200).json({
      id: response.id,
      model: DEFAULT_MODEL,
      reply: response.output_text || "",
    });
  } catch (error) {
    return res.status(500).json({
      message: error?.message || "OpenAI enquiry request failed.",
    });
  }
});

EnquiriesRouter.post("/greeting", async function (req, res) {
  const client = getOpenAIClient();
  const userId = req.body?.userId?.trim();
  const username = req.body?.username?.trim();

  if (!userId && !username) {
    return res.status(400).json({
      message: "userId or username is required.",
    });
  }

  try {
    const user = await UserModel.findOne(
      userId ? { _id: userId } : { "info.username": username }
    )
      .select(
        "info.username info.firstname info.lastname friends notifications posts terminology study_session schoolPlanner study.structure_keywords study.function_keywords"
      )
      .lean();

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const summary = buildUserSummary(user);

    if (!client) {
      return res.status(200).json({
        reply: buildFallbackGreeting(summary),
        source: "fallback",
      });
    }

    const response = await client.responses.create({
      model: DEFAULT_MODEL,
      instructions: DEFAULT_GREETING_INSTRUCTIONS,
      input: `Doctor username: ${summary.username}
First name: ${summary.firstname}
Last name: ${summary.lastname}
Database summary:
- Friends: ${summary.counts.friends}
- Notifications: ${summary.counts.notifications}
- Posts: ${summary.counts.posts}
- Terminology terms: ${summary.counts.terminology}
- Study sessions: ${summary.counts.sessions}
- Courses: ${summary.counts.courses}
- Lectures: ${summary.counts.lectures}
- Structure keywords: ${summary.counts.structureKeywords}
- Function keywords: ${summary.counts.functionKeywords}`,
    });

    return res.status(200).json({
      reply: response.output_text || buildFallbackGreeting(summary),
      source: "openai",
    });
  } catch (error) {
    return res.status(200).json({
      reply: getGreetingErrorReply(error, summary),
      source: "fallback",
    });
  }
});

export default EnquiriesRouter;
