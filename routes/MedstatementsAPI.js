//For user data
import express from "express";
import MedstatementsModel from "../models/Medstatements.js";
const MedstatementsRouter = express.Router();
import UserModel from "../models/Users.js";
import "dotenv/config.js";
//..............CREATE LECTURE
MedstatementsRouter.post("/createMedstatements", function (req, res, next) {
  MedstatementsModel.create(req.body)
    .then((result) => {
      if (result) {
        return res.status(201).json(result);
      }
    })
    .catch(next);
});

//..............ADD LECTURE TO USER.............
MedstatementsRouter.post(
  "/addMedstatements/:my_id/:lecture_id",
  function (req, res, next) {
    UserModel.findOne({ _id: req.params.my_id })
      .then((mine) => {
        mine.Medstatements.push(req.params.lecture_id);
        return mine.save();
      })
      .then((result) => {
        if (result) {
          res.status(201).json({ lecID: req.params.lecture_id });
        } else {
          res.status(500).json();
        }
      })
      .catch(next);
  }
);

//////////////RetriveMedstatements
// MedstatementsRouter.get("/retrieveMedstatements/:my_id", function (req, res, next) {
//   MedstatementsModel.findOne({ _id: req.params.my_id })
//     .then((mine) => {
//       res.status(200).json(mine.Medstatements);
//     })
//     .catch(next);
// });

//////////////////////DeleteLecture
// MedstatementsRouter.delete(
//   "/deleteLecture/:lectureId",
//   function (req, res, next) {
//     MedstatementsModel.findOneAndDelete({ _id: req.params.lectureId })
//       .then((result) => {
//         if (result) {
//           res.status(201).json();
//         }
//       })
//       .catch(next);
//   }
// );

//Attach all the routes to router\
export default MedstatementsRouter;
