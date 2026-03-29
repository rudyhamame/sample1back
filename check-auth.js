import jwt from "jsonwebtoken";

const checkAuth = (req, res, next) => {
  const authorizationHeader = String(req.headers.authorization || "").trim();

  if (!authorizationHeader) {
    return res.status(401).json({
      message: "Missing authorization header.",
      reason: "missing_authorization_header",
    });
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !String(token || "").trim()) {
    return res.status(401).json({
      message: "Invalid authorization header.",
      reason: "invalid_authorization_header",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_KEY);
    req.authentication = decoded;
    next();
  } catch (error) {
    const isExpired = error?.name === "TokenExpiredError";

    res.status(401).json({
      message: isExpired ? "Session expired. Please sign in again." : "Invalid login session.",
      reason: isExpired ? "token_expired" : "token_invalid",
    });
  }
};

export default checkAuth;
