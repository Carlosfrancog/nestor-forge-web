'use strict';

const { generic, laravelInertia } = require('./laravelInertia');

function recipesFor(profile) {
  return profile === 'laravel-inertia' ? laravelInertia : generic;
}

module.exports = { recipesFor };
