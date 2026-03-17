import mongoose from "mongoose";
const Schema = mongoose.Schema;
const PostsSchema = new Schema({
  id: { type: Schema.Types.ObjectId, required: true },
  firstname: { type: String, required: true },
  lastname: { type: String, required: true },
  note: { type: String, required: true },
  category: { type: String, required: true },
  subject: { type: String, required: true },
  reference: { type: String, required: false },
  page_num: { type: Number, required: false },
  date: { type: Date, default: Date.now() },
  comments: [],
});

const PostsModel = mongoose.model("posts", PostsSchema);
export default PostsModel;
