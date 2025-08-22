
function findRoot(f, fprime, guess, options) {
    options = options || {};
    var tolerance = options.tolerance || 0.0000001;
    var epsilon = options.epsilon || 0.000000000001;
    var maxIterations = options.maxIterations || 100;
    var haveWeFoundSolution = false; 
    var result;
   
    for (var i = 0; i < maxIterations; ++i) {
      var denominator = fprime(guess);
      if (Math.abs(denominator) < epsilon) {
        return false
      }
   
      result = guess - (f(guess) / denominator);
      
      var resultWithinTolerance = Math.abs(result - guess) < tolerance;
      if (resultWithinTolerance) { 
        return result
      }

      guess = result;
    }
    
    return false;
  }
