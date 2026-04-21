export const requireSelfParam =
  (paramName) =>
  (req, res, next) => {
    const authenticatedUserId = String(req.authentication?.userId || "").trim();
    const paramValue = String(req.params?.[paramName] || "").trim();

    if (!authenticatedUserId) {
      return res.status(401).json({
        message: "Missing login session.",
      });
    }

    if (!paramValue) {
      return res.status(400).json({
        message: `Missing parameter: ${paramName}.`,
      });
    }

    if (authenticatedUserId !== paramValue) {
      return res.status(403).json({
        message: "You are not allowed to perform this action.",
      });
    }

    return next();
  };

