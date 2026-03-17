import express from "express";
import PostsModel from "../models/Posts.js";
import UserModel from "../models/Users.js";
const PostsRouter = express.Router();

///////POST A POST//The best architecture
PostsRouter.post("/postAdd/:my_id/:post_id", function (req, res, next) {
  UserModel.findOne({ _id: req.params.my_id })
    .then((mine) => {
      mine.posts.push(req.params.post_id);
      return mine.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json(result);
      } else {
        res.status(500).json();
      }
    })
    .catch(next);
});

///////////post a comment
PostsRouter.put("/commentPost/:post_id/:comment", function (req, res, next) {
  PostsModel.findOne({ _id: req.params.post_id })
    .then((post) => {
      console.log(post);
      post.comments.push(req.params.comment);
      return post.save();
    })
    .then((result) => {
      if (result) {
        res.status(201).json(result);
      } else {
        res.status(500).json();
      }
    })
    .catch(next);
});

/////////Add Posts area
///Add your chat
PostsRouter.post("/addNew", function (req, res, next) {
  PostsModel.create(req.body)
    .then((result) => {
      if (result) {
        return res.status(201).json(result);
      }
    })
    .catch(next);
});

//////////////////////delete a post
PostsRouter.delete("/deletePost/:postID", function (req, res, next) {
  PostsModel.findByIdAndDelete(req.params.postID)
    .then((result) => {
      res.status(201).json(result);
    })
    .catch(next);
});

//////////////////////update a post
PostsRouter.put("/updatePost/:postID", function (req, res, next) {
  PostsModel.findOneAndUpdate({ _id: req.params.postID }, req.body)
    .then((result) => {
      res.status(201).json(result);
    })
    .catch(next);
});

export default PostsRouter;
