import mongoose from "mongoose";
const Schema = mongoose.Schema;
const SchoolPlannerSchema = new Schema({
  course: {
    inClass: {
      time: {},
      exam: {
        date: {},
        fullGrade: {},
        expectedGrade: {},
        actualGrade: {},
        yearAndTerm: {},
      },
      class: {},
      status: {},
    },
    outOfClass: {
      time: {},
      exam: {
        date: {},
        fullGrade: {},
        expectedGrade: {},
        actualGrade: {},
        yearAndTerm: {},
      },
      class: {},
      status: {},
    },
    yearAndTerm: {},
    instructors: [],
  },
  lecture: {
    topic: {},
    outline: [],
    type: {},
    course: {},
    instructor: {},
    writer: {},
    date: {},
    length: {},
    progress: {},
    structures: [],
    functions: [],
    pastQuestions: {
      totalNum: {},
      questions: [
        {
          class: {},
          questionSentence: {},
          trueChoices: [],
          wrongChoices: [],
        },
      ],
    },
  },
});

const SchoolPlannerModel = mongoose.model("schoolPlanner", SchoolPlannerSchema);
export default SchoolPlannerModel;
