import mongoose from "mongoose";
const Schema = mongoose.Schema;
const KeywordsSchema = new Schema({
  name: { type: String },
  level: { type: String },
  properties: { Array: String },
});

const KeywordsModel = mongoose.model("Keyword", KeywordsSchema);
export default KeywordsModel;
