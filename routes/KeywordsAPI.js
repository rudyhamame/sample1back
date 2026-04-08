//For user data
import express from "express";
import KeywordsModel from "../models/Keywords.js";
const KeywordsRouter = express.Router();
import UserModel from "../models/Users.js";
import "dotenv/config";
//..............CREATE KEYWORDS
KeywordsRouter.post("/createKeyword", function (req, res, next) {
  KeywordsModel.create(req.body)
    .then((result) => {
      return res.status(201).json({
        keywordID: result._id,
      });
    })
    .catch(next);
});

//..............Connect new Keywords to User.............
KeywordsRouter.post("/addKeyword/:my_id/:keywordID", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      user.keywords.push(req.params.keywordID);
      return user.save();
    })
    .then((user) => {
      if (user) {
        res.status(201).json();
      } else {
        res.status(500).json();
      }
    })
    .catch(next);
});

//...........ADD KEYWORD............

KeywordsRouter.post("/addKeyword/:my_id", function (req, res, next) {
  KeywordsModel.findOne({ name: req.params.name })
    .then((keywords) => {
      if (keywords) {
        keywords.properties.push(req.body.properties);
        return keywords.save();
      } else {
        KeywordsRouter.post("/addKeyword/:my_id", function (req, res, next) {
          KeywordsModel.create(req.body);
        });
      }
    })
    .then((result) => {
      console.log(result);
      if (result) res.status(201).json();
    })

    .catch(next);
});
//Attach all the routes to router\
export default KeywordsRouter;
