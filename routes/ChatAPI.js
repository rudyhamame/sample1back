import express from "express";
import ChatModel from "../models/Chat.js";
import UserModel from "../models/Users.js";
import { emitUserRefresh } from "../helpers/realtime.js";
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
  const senderId = req.params.my_id;
  const friendId = req.params.friendID;
  const { message } = req.body;
  const io = req.app.locals.io;

  Promise.all([
    ChatModel.findOne({ _id: senderId }).then((chatObject) => {
      chatObject.conversation.push({
        _id: friendId,
        message,
        from: "me",
      });
      return chatObject.save();
    }),
    ChatModel.findOne({ _id: friendId }).then((chatObject) => {
      chatObject.conversation.push({
        _id: senderId,
        message,
        from: "them",
      });
      return chatObject.save();
    }),
  ])
    .then(() => {
      emitUserRefresh(io, [senderId, friendId], "chat:message", {
        friendId,
      });
      res.status(201).json({
        message: "Message sent.",
      });
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
