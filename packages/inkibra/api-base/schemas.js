var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// ../../../node_modules/.bun/typia@9.7.2+dd9c7f700dbbebd3/node_modules/typia/lib/internal/_validateReport.js
var require__validateReport = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports._validateReport = undefined;
  var _validateReport = (array) => {
    const reportable = (path) => {
      if (array.length === 0)
        return true;
      const last = array[array.length - 1].path;
      return path.length > last.length || last.substring(0, path.length) !== path;
    };
    return (exceptable, error) => {
      var _a;
      if (exceptable && reportable(error.path)) {
        if (error.value === undefined)
          (_a = error.description) !== null && _a !== undefined || (error.description = [
            "The value at this path is `undefined`.",
            "",
            `Please fill the \`${error.expected}\` typed value next time.`
          ].join(`
`));
        array.push(error);
      }
      return false;
    };
  };
  exports._validateReport = _validateReport;
});

// ../../../node_modules/.bun/typia@9.7.2+dd9c7f700dbbebd3/node_modules/typia/lib/internal/_createStandardSchema.js
var require__createStandardSchema = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports._createStandardSchema = undefined;
  var _createStandardSchema = (fn) => Object.assign(fn, {
    "~standard": {
      version: 1,
      vendor: "typia",
      validate: (input) => {
        const result = fn(input);
        if (result.success) {
          return {
            value: result.data
          };
        } else {
          return {
            issues: result.errors.map((error) => ({
              message: `expected ${error.expected}, got ${error.value}`,
              path: typiaPathToStandardSchemaPath(error.path)
            }))
          };
        }
      }
    }
  });
  exports._createStandardSchema = _createStandardSchema;
  var PathParserState;
  (function(PathParserState2) {
    PathParserState2[PathParserState2["Start"] = 0] = "Start";
    PathParserState2[PathParserState2["Property"] = 1] = "Property";
    PathParserState2[PathParserState2["StringKey"] = 2] = "StringKey";
    PathParserState2[PathParserState2["NumberKey"] = 3] = "NumberKey";
  })(PathParserState || (PathParserState = {}));
  var typiaPathToStandardSchemaPath = (path) => {
    if (!path.startsWith("$input")) {
      throw new Error(`Invalid path: ${JSON.stringify(path)}`);
    }
    const segments = [];
    let currentSegment = "";
    let state = PathParserState.Start;
    let index = "$input".length - 1;
    while (index < path.length - 1) {
      index++;
      const char = path[index];
      if (state === PathParserState.Property) {
        if (char === "." || char === "[") {
          segments.push({
            key: currentSegment
          });
          state = PathParserState.Start;
        } else if (index === path.length - 1) {
          currentSegment += char;
          segments.push({
            key: currentSegment
          });
          index++;
          state = PathParserState.Start;
        } else {
          currentSegment += char;
        }
      } else if (state === PathParserState.StringKey) {
        if (char === '"') {
          segments.push({
            key: JSON.parse(currentSegment + char)
          });
          index += 2;
          state = PathParserState.Start;
        } else if (char === "\\") {
          currentSegment += path[index];
          index++;
          currentSegment += path[index];
        } else {
          currentSegment += char;
        }
      } else if (state === PathParserState.NumberKey) {
        if (char === "]") {
          segments.push({
            key: Number.parseInt(currentSegment)
          });
          index++;
          state = PathParserState.Start;
        } else {
          currentSegment += char;
        }
      }
      if (state === PathParserState.Start && index < path.length - 1) {
        const newChar = path[index];
        currentSegment = "";
        if (newChar === "[") {
          if (path[index + 1] === '"') {
            state = PathParserState.StringKey;
            index++;
            currentSegment = '"';
          } else {
            state = PathParserState.NumberKey;
          }
        } else if (newChar === ".") {
          state = PathParserState.Property;
        } else {
          throw new Error("Unreachable: pointer points invalid character");
        }
      }
    }
    if (state !== PathParserState.Start) {
      throw new Error(`Failed to parse path: ${JSON.stringify(path)}`);
    }
    return segments;
  };
});

// ../../../node_modules/.bun/typia@9.7.2+dd9c7f700dbbebd3/node_modules/typia/lib/internal/_accessExpressionAsString.js
var require__accessExpressionAsString = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports._accessExpressionAsString = undefined;
  var _accessExpressionAsString = (str) => variable(str) ? `.${str}` : `[${JSON.stringify(str)}]`;
  exports._accessExpressionAsString = _accessExpressionAsString;
  var variable = (str) => reserved(str) === false && /^[a-zA-Z_$][a-zA-Z_$0-9]*$/g.test(str);
  var reserved = (str) => RESERVED.has(str);
  var RESERVED = new Set([
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "new",
    "null",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with"
  ]);
});

// schemas.ts
var __typia_transform__validateReport = __toESM(require__validateReport(), 1);
var __typia_transform__createStandardSchema = __toESM(require__createStandardSchema(), 1);
var __typia_transform__accessExpressionAsString = __toESM(require__accessExpressionAsString(), 1);
var validateNoData = (() => {
  const __is = (input) => input !== null && input === undefined;
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (input2 !== null || _report(true, {
        path: _path + "",
        expected: "undefined",
        value: input2
      })) && (input2 === undefined || _report(true, {
        path: _path + "",
        expected: "undefined",
        value: input2
      })))(input, "$input", true);
      const success = errors.length === 0;
      return success ? {
        success,
        data: input
      } : {
        success,
        errors,
        data: input
      };
    }
    return {
      success: true,
      data: input
    };
  });
})();
var validateSimpleSuccess = (() => {
  const _io0 = (input) => input.type === "Ok" && input.value === true && input.statusCode === 200;
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), input.value === true || _report(_exceptionable, {
    path: _path + ".value",
    expected: "true",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "SimpleSuccess",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "SimpleSuccess",
        value: input2
      }))(input, "$input", true);
      const success = errors.length === 0;
      return success ? {
        success,
        data: input
      } : {
        success,
        errors,
        data: input
      };
    }
    return {
      success: true,
      data: input
    };
  });
})();
var validateEmptyObject = (() => {
  const _io0 = (input) => Object.keys(input).every((key) => {
    const value = input[key];
    if (value === undefined)
      return true;
    return value !== null && value === undefined;
  });
  const _vo0 = (input, _path, _exceptionable = true) => [_exceptionable === false || Object.keys(input).map((key) => {
    const value = input[key];
    if (value === undefined)
      return true;
    return (value !== null || _report(_exceptionable, {
      path: _path + __typia_transform__accessExpressionAsString._accessExpressionAsString(key),
      expected: "undefined",
      value
    })) && (value === undefined || _report(_exceptionable, {
      path: _path + __typia_transform__accessExpressionAsString._accessExpressionAsString(key),
      expected: "undefined",
      value
    }));
  }).every((flag) => flag)].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && Array.isArray(input) === false && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null && Array.isArray(input2) === false || _report(true, {
        path: _path + "",
        expected: "EmptyObject",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "EmptyObject",
        value: input2
      }))(input, "$input", true);
      const success = errors.length === 0;
      return success ? {
        success,
        data: input
      } : {
        success,
        errors,
        data: input
      };
    }
    return {
      success: true,
      data: input
    };
  });
})();
export {
  validateSimpleSuccess,
  validateNoData,
  validateEmptyObject
};
