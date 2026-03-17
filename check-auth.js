import jwt from "jsonwebtoken";
const checkAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_KEY);
    req.authentication = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      message: "Auth failed",
    });
  }
};

export default checkAuth;
