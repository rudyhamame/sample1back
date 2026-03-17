import express from "express";
import TodoSchema from "../../models/Todo.js";
const TodoSearcher = express.Router();

//get a list of ninjas the the db
TodoSearcher.get("/Todo/search", function (req, res, next) {
  TodoSchema.find({ deadline: req.query.deadline }).then((result) =>
    res.json(result)
  );
});

//Attach all the routes to router\
export default TodoSearcher;
