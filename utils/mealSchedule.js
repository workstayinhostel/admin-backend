const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MEALS = ['breakfast', 'mealLunch', 'snacks', 'dinner'];

const createMealSlot = (from, to, dishes) => ({ from, to, dishes });

const DEFAULT_MEAL_SCHEDULE = {
  Sunday: {
    breakfast: createMealSlot('6:00 AM', '7:00 AM', ['Milk', 'Tea', 'Biscuit']),
    mealLunch: createMealSlot('9:00 AM', '11:00 AM', ['Rice', 'Pulse', 'Vegetable']),
    snacks: createMealSlot('3:00 PM', '5:00 PM', ['Fried rice', 'Tea']),
    dinner: createMealSlot('6:30 PM', '8:00 PM', ['Rice', 'Pulse', 'Vegetable', 'Aachar'])
  },
  Monday: {
    breakfast: createMealSlot('6:00 AM', '7:00 AM', ['Milk', 'Tea', 'Biscuit']),
    mealLunch: createMealSlot('9:00 AM', '11:00 AM', ['Rice', 'Pulse', 'Vegetable']),
    snacks: createMealSlot('3:00 PM', '5:00 PM', ['Doughnut', 'Tea']),
    dinner: createMealSlot('6:30 PM', '8:00 PM', ['Rice', 'Pulse', 'Chicken/Paneer'])
  },
  Tuesday: {
    breakfast: createMealSlot('6:00 AM', '7:00 AM', ['Milk', 'Tea', 'Biscuit']),
    mealLunch: createMealSlot('9:00 AM', '11:00 AM', ['Rice', 'Pulse', 'Vegetable']),
    snacks: createMealSlot('3:00 PM', '5:00 PM', ['Chowmein']),
    dinner: createMealSlot('6:30 PM', '8:00 PM', ['Rice', 'Pulse', 'Vegetable', 'Aachar'])
  },
  Wednesday: {
    breakfast: createMealSlot('6:00 AM', '7:00 AM', ['Milk', 'Tea', 'Biscuit']),
    mealLunch: createMealSlot('9:00 AM', '11:00 AM', ['Rice', 'Pulse', 'Vegetable']),
    snacks: createMealSlot('3:00 PM', '5:00 PM', ['Samosa', 'Tarkari']),
    dinner: createMealSlot('6:30 PM', '8:00 PM', ['Rice', 'Pulse', 'Chicken/Paneer'])
  },
  Thursday: {
    breakfast: createMealSlot('6:00 AM', '7:00 AM', ['Milk', 'Tea', 'Biscuit']),
    mealLunch: createMealSlot('9:00 AM', '11:00 AM', ['Rice', 'Pulse', 'Vegetable']),
    snacks: createMealSlot('3:00 PM', '5:00 PM', ['Fried chaana', 'Bhuja']),
    dinner: createMealSlot('6:30 PM', '8:00 PM', ['Rice', 'Pulse', 'Vegetable', 'Aachar'])
  },
  Friday: {
    breakfast: createMealSlot('6:00 AM', '7:00 AM', ['Milk', 'Tea', 'Biscuit']),
    mealLunch: createMealSlot('9:00 AM', '11:00 AM', ['Rice', 'Pulse', 'Vegetable']),
    snacks: createMealSlot('3:00 PM', '5:00 PM', ['Chowmein']),
    dinner: createMealSlot('6:30 PM', '8:00 PM', ['Rice', 'Pulse', 'Vegetable', 'Aachar'])
  },
  Saturday: {
    breakfast: createMealSlot('6:00 AM', '7:00 AM', ['Milk', 'Tea', 'Biscuit']),
    mealLunch: createMealSlot('9:00 AM', '11:00 AM', ['Rice', 'Pulse', 'Vegetable']),
    snacks: createMealSlot('3:00 PM', '5:00 PM', ['Paratha', 'Chutney']),
    dinner: createMealSlot('6:30 PM', '8:00 PM', ['Rice', 'Pulse', 'Chicken/Paneer'])
  }
};

const normalizeMealSchedule = (schedule, baseSchedule = DEFAULT_MEAL_SCHEDULE) => {
  const input = schedule && typeof schedule === 'object' ? schedule : {};

  return Object.fromEntries(DAYS.map(day => {
    const inputDay = input[day] && typeof input[day] === 'object' ? input[day] : {};
    const baseDay = baseSchedule?.[day] || DEFAULT_MEAL_SCHEDULE[day];

    return [day, Object.fromEntries(MEALS.map(meal => {
      const inputSlot = inputDay[meal] && typeof inputDay[meal] === 'object' ? inputDay[meal] : {};
      const baseSlot = baseDay?.[meal] || DEFAULT_MEAL_SCHEDULE[day][meal];
      const dishes = Array.isArray(inputSlot.dishes)
        ? inputSlot.dishes.map(dish => String(dish).trim()).filter(Boolean)
        : [];

      return [meal, {
        from: String(inputSlot.from || baseSlot.from).trim(),
        to: String(inputSlot.to || baseSlot.to).trim(),
        dishes: dishes.length ? dishes : [...baseSlot.dishes]
      }];
    }))];
  }));
};

module.exports = { DEFAULT_MEAL_SCHEDULE, normalizeMealSchedule };
