import express from "express";
import FriendModel from "../models/Profiles.js";
import UserModel from "../models/Users.js";
const ConnectionStatusRouter = express.Router();

//app a new nonja to the db

ConnectionStatusRouter.put("/user/connection/:id", function (req, res, next) {
  UserModel.findByIdAndUpdate({ _id: req.params.id }, req.body, {
    useFindAndModify: false,
  })
    .then(function (result) {
      res.json(result);
    })
    .catch(next);
});

//Attach all the routes to router\
export default ConnectionStatusRouter;
