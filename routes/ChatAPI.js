import express from "express";
import ChatModel from "../models/Chat.js";
import UserModel from "../models/Users.js";
const ChatRouter = express.Router();

// ///Add your chat
// ChatRouter.post("/addNew/:my_id", function (req, res, next) {
//   ChatModel.findOne({ _id: req.params.my_id })
//     .then((result) => {
//       if (!result) {
//         ChatModel.create({ _id: req.params.my_id });
//       }
//     })
//     .then((result) => {
//       return res.json(result);
//     });
// });

//Send to me chat
// ChatRouter.post("/sendMessage/:friendID/:my_id", function (req, res, next) {
//   UserModel.findByIdAndUpdate(
//     { _id: req.params.my_id },
//     { chat: req.params.my_id }
//   ).then(() => {
//     ChatModel.findOne({ _id: req.params.friendID })
//       .then((chatObject) => {
//         if (!chatObject) {
//           ChatModel.create({ _id: req.params.friendID })
//             .then(() => {
//               ChatModel.findOne({
//                 _id: req.params.friendID,
//               });
//             })
//             .then((chatObject) => {
//               chatObject.conversation.push(req.body);
//               return chatObject.save();
//             })
//             .then((result) => {
//               return res.status(201).json(result.conversation);
//             })
//             .catch(next);
//         } else {
//           chatObject.conversation.push(req.body);
//           return chatObject.save();
//         }
//       })
//       .then((result) => {
//         return res.status(201).json(result.conversation);
//       })
//       .catch(next);
//   });
// });

//Send to friend chat
ChatRouter.post("/sendMessage/:friendID/:my_id", function (req, res, next) {
  ChatModel.findOne({ _id: req.params.my_id })
    .then((chatObject) => {
      chatObject.conversation.push({
        _id: req.params.friendID,
        message: req.body.message,
        from: "me",
      });
      return chatObject.save();
    })
    .then(() => {
      res.status(201).json();
    })
    .catch(next);
  ChatModel.findOne({ _id: req.params.friendID })
    .then((chatObject) => {
      chatObject.conversation.push({
        _id: req.params.my_id,
        message: req.body.message,
        from: "them",
      });
      return chatObject.save();
    })
    .then(() => {
      res.status(201).json();
    })
    .catch(next);
});

//////////////////////Preparing chat
ChatRouter.post("/prepareChat/:my_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((user) => {
      if (user.chat == null) {
        UserModel.findByIdAndUpdate(
          { _id: req.params.my_id },
          { chat: req.params.my_id },
          { useFindAndModify: false }
        ).then(() => {
          ChatModel.create({ _id: req.params.my_id });
        });
      }
    })
    .then(() => {
      return res.status(201).json();
    })
    .catch(next);
});

//Attach all the routes to router\
export default ChatRouter;
