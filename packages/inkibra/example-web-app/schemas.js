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

// ../../../node_modules/.bun/typia@9.7.2+351279184def17a6/node_modules/typia/lib/internal/_validateReport.js
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

// ../../../node_modules/.bun/typia@9.7.2+351279184def17a6/node_modules/typia/lib/internal/_createStandardSchema.js
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

// ../../../node_modules/.bun/typia@9.7.2+351279184def17a6/node_modules/typia/lib/internal/_accessExpressionAsString.js
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
var validateUser = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.username === "string" && typeof input.createdAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.username === "string" || _report(_exceptionable, {
    path: _path + ".username",
    expected: "string",
    value: input.username
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
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
        expected: "User",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "User",
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
var validateSessionData = (() => {
  const _io0 = (input) => typeof input.userId === "string" && typeof input.username === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.userId === "string" || _report(_exceptionable, {
    path: _path + ".userId",
    expected: "string",
    value: input.userId
  }), typeof input.username === "string" || _report(_exceptionable, {
    path: _path + ".username",
    expected: "string",
    value: input.username
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
        expected: "SessionData",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "SessionData",
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
var validateBoard = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && typeof input.ownerId === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.ownerId === "string" || _report(_exceptionable, {
    path: _path + ".ownerId",
    expected: "string",
    value: input.ownerId
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
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
        expected: "Board",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Board",
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
var validateBoardList = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.boardId === "string" && typeof input.name === "string" && typeof input.position === "number" && typeof input.createdAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
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
        expected: "BoardList",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "BoardList",
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
var validateCard = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.listId === "string" && typeof input.boardId === "string" && typeof input.title === "string" && typeof input.description === "string" && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "string",
    value: input.listId
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
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
        expected: "Card",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Card",
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
var validateChannel = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && (input.boardId === null || typeof input.boardId === "string") && typeof input.createdBy === "string" && typeof input.createdAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.boardId === null || typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "(null | string)",
    value: input.boardId
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
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
        expected: "Channel",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Channel",
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
var validateMessage = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.channelId === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.channelId === "string" || _report(_exceptionable, {
    path: _path + ".channelId",
    expected: "string",
    value: input.channelId
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
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
        expected: "Message",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Message",
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
var validateBoardsLoaderResponse = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && typeof input.ownerId === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.ownerId === "string" || _report(_exceptionable, {
    path: _path + ".ownerId",
    expected: "string",
    value: input.ownerId
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const __is = (input) => Array.isArray(input) && input.every((elem) => typeof elem === "object" && elem !== null && _io0(elem));
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (Array.isArray(input2) || _report(true, {
        path: _path + "",
        expected: "Array<Board>",
        value: input2
      })) && input2.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(true, {
        path: _path + "[" + _index2 + "]",
        expected: "Board",
        value: elem
      })) && _vo0(elem, _path + "[" + _index2 + "]", true) || _report(true, {
        path: _path + "[" + _index2 + "]",
        expected: "Board",
        value: elem
      })).every((flag) => flag) || _report(true, {
        path: _path + "",
        expected: "Array<Board>",
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
var validateBoardLoaderResponse = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && typeof input.ownerId === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string" && (Array.isArray(input.lists) && input.lists.every((elem) => typeof elem === "object" && elem !== null && _io1(elem)));
  const _io1 = (input) => typeof input.id === "string" && typeof input.boardId === "string" && typeof input.name === "string" && typeof input.position === "number" && typeof input.createdAt === "string" && (Array.isArray(input.cards) && input.cards.every((elem) => typeof elem === "object" && elem !== null && _io2(elem)));
  const _io2 = (input) => typeof input.id === "string" && typeof input.listId === "string" && typeof input.boardId === "string" && typeof input.title === "string" && typeof input.description === "string" && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.ownerId === "string" || _report(_exceptionable, {
    path: _path + ".ownerId",
    expected: "string",
    value: input.ownerId
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  }), (Array.isArray(input.lists) || _report(_exceptionable, {
    path: _path + ".lists",
    expected: "Array<BoardListWithCards>",
    value: input.lists
  })) && input.lists.map((elem, _index3) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".lists[" + _index3 + "]",
    expected: "BoardListWithCards",
    value: elem
  })) && _vo1(elem, _path + ".lists[" + _index3 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".lists[" + _index3 + "]",
    expected: "BoardListWithCards",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".lists",
    expected: "Array<BoardListWithCards>",
    value: input.lists
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), (Array.isArray(input.cards) || _report(_exceptionable, {
    path: _path + ".cards",
    expected: "Array<Card>",
    value: input.cards
  })) && input.cards.map((elem, _index4) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".cards[" + _index4 + "]",
    expected: "Card",
    value: elem
  })) && _vo2(elem, _path + ".cards[" + _index4 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".cards[" + _index4 + "]",
    expected: "Card",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".cards",
    expected: "Array<Card>",
    value: input.cards
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "string",
    value: input.listId
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
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
        expected: "BoardWithContents",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "BoardWithContents",
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
var validateChannelsLoaderResponse = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && (input.boardId === null || typeof input.boardId === "string") && typeof input.createdBy === "string" && typeof input.createdAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.boardId === null || typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "(null | string)",
    value: input.boardId
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const __is = (input) => Array.isArray(input) && input.every((elem) => typeof elem === "object" && elem !== null && _io0(elem));
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (Array.isArray(input2) || _report(true, {
        path: _path + "",
        expected: "Array<Channel>",
        value: input2
      })) && input2.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(true, {
        path: _path + "[" + _index2 + "]",
        expected: "Channel",
        value: elem
      })) && _vo0(elem, _path + "[" + _index2 + "]", true) || _report(true, {
        path: _path + "[" + _index2 + "]",
        expected: "Channel",
        value: elem
      })).every((flag) => flag) || _report(true, {
        path: _path + "",
        expected: "Array<Channel>",
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
var validateChannelDetailLoaderResponse = (() => {
  const _io0 = (input) => typeof input.channel === "object" && input.channel !== null && _io1(input.channel) && (Array.isArray(input.messages) && input.messages.every((elem) => typeof elem === "object" && elem !== null && _io2(elem)));
  const _io1 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && (input.boardId === null || typeof input.boardId === "string") && typeof input.createdBy === "string" && typeof input.createdAt === "string";
  const _io2 = (input) => typeof input.id === "string" && typeof input.channelId === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [(typeof input.channel === "object" && input.channel !== null || _report(_exceptionable, {
    path: _path + ".channel",
    expected: "Channel",
    value: input.channel
  })) && _vo1(input.channel, _path + ".channel", _exceptionable) || _report(_exceptionable, {
    path: _path + ".channel",
    expected: "Channel",
    value: input.channel
  }), (Array.isArray(input.messages) || _report(_exceptionable, {
    path: _path + ".messages",
    expected: "Array<Message>",
    value: input.messages
  })) && input.messages.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".messages[" + _index2 + "]",
    expected: "Message",
    value: elem
  })) && _vo2(elem, _path + ".messages[" + _index2 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".messages[" + _index2 + "]",
    expected: "Message",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".messages",
    expected: "Array<Message>",
    value: input.messages
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.boardId === null || typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "(null | string)",
    value: input.boardId
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.channelId === "string" || _report(_exceptionable, {
    path: _path + ".channelId",
    expected: "string",
    value: input.channelId
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
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
        expected: "__type",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "__type",
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
var validateLoaderError = (() => {
  const _io0 = (input) => typeof input.type === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.type === "string" || _report(_exceptionable, {
    path: _path + ".type",
    expected: "string",
    value: input.type
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
        expected: "__type",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "__type",
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
var isUser = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.username === "string" && typeof input.createdAt === "string";
  return (input) => typeof input === "object" && input !== null && _io0(input);
})();
var isSessionData = (() => {
  const _io0 = (input) => typeof input.userId === "string" && typeof input.username === "string";
  return (input) => typeof input === "object" && input !== null && _io0(input);
})();
var isBoard = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && typeof input.ownerId === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  return (input) => typeof input === "object" && input !== null && _io0(input);
})();
var isCard = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.listId === "string" && typeof input.boardId === "string" && typeof input.title === "string" && typeof input.description === "string" && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  return (input) => typeof input === "object" && input !== null && _io0(input);
})();
var isChannel = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && (input.boardId === null || typeof input.boardId === "string") && typeof input.createdBy === "string" && typeof input.createdAt === "string";
  return (input) => typeof input === "object" && input !== null && _io0(input);
})();
var isMessage = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.channelId === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string";
  return (input) => typeof input === "object" && input !== null && _io0(input);
})();
var validateTaskPanelQueryTaskId = (() => {
  const __is = (input) => input === undefined || typeof input === "string";
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => input2 === undefined || typeof input2 === "string" || _report(true, {
        path: _path + "",
        expected: "(string | undefined)",
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
var validateLoginPathParams = (() => {
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
        expected: "Login.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Login.PathParams",
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
var validateLoginPathQuery = (() => {
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
        expected: "Login.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Login.PathQuery",
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
var validateLoginBody = (() => {
  const _io0 = (input) => typeof input.username === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.username === "string" || _report(_exceptionable, {
    path: _path + ".username",
    expected: "string",
    value: input.username
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
        expected: "LoginRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "LoginRequest",
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
var validateLoginResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => typeof input.user === "object" && input.user !== null && _io2(input.user);
  const _io2 = (input) => typeof input.id === "string" && typeof input.username === "string" && typeof input.createdAt === "string";
  const _io3 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io4(input.error)) && input.statusCode === 400;
  const _io4 = (input) => input.type === "InvalidUsername";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io3(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "LoginResponse",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "LoginResponse",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [(typeof input.user === "object" && input.user !== null || _report(_exceptionable, {
    path: _path + ".user",
    expected: "User",
    value: input.user
  })) && _vo2(input.user, _path + ".user", _exceptionable) || _report(_exceptionable, {
    path: _path + ".user",
    expected: "User",
    value: input.user
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.username === "string" || _report(_exceptionable, {
    path: _path + ".username",
    expected: "string",
    value: input.username
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo4(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 400 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "400",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo4 = (input, _path, _exceptionable = true) => [input.type === "InvalidUsername" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"InvalidUsername"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo3(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<LoginResponse, OK> | SerializableResult.ErrWithStatusCode<__type, BAD_REQUEST>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, BAD_REQUEST> | SerializableResult.OkWithStatusCode<LoginResponse, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, BAD_REQUEST> | SerializableResult.OkWithStatusCode<LoginResponse, OK>)",
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
var validateLogoutPathParams = (() => {
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
        expected: "Logout.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Logout.PathParams",
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
var validateLogoutPathQuery = (() => {
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
        expected: "Logout.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Logout.PathQuery",
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
var validateLogoutBody = (() => {
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
        expected: "Logout.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Logout.Body",
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
var validateLogoutResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => input.success === true;
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "__type",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "__type",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.success === true || _report(_exceptionable, {
    path: _path + ".success",
    expected: "true",
    value: input.success
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
        expected: "Logout.Response",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Logout.Response",
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
var validateGetCurrentUserPathParams = (() => {
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
        expected: "GetCurrentUser.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetCurrentUser.PathParams",
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
var validateGetCurrentUserPathQuery = (() => {
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
        expected: "GetCurrentUser.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetCurrentUser.PathQuery",
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
var validateGetCurrentUserBody = (() => {
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
        expected: "GetCurrentUser.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetCurrentUser.Body",
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
var validateGetCurrentUserResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (input.value === null || typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.username === "string" && typeof input.createdAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), input.value === null || (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "(User | null)",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "(User | null)",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.username === "string" || _report(_exceptionable, {
    path: _path + ".username",
    expected: "string",
    value: input.username
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
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
        expected: "GetCurrentUser.Response",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetCurrentUser.Response",
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
var validateListBoardsPathParams = (() => {
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
        expected: "ListBoards.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListBoards.PathParams",
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
var validateListBoardsPathQuery = (() => {
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
        expected: "ListBoards.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListBoards.PathQuery",
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
var validateListBoardsBody = (() => {
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
        expected: "ListBoards.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListBoards.Body",
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
var validateListBoardsResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (Array.isArray(input.value) && input.value.every((elem) => typeof elem === "object" && elem !== null && _io1(elem))) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && typeof input.ownerId === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 401;
  const _io3 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (Array.isArray(input.value) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Board>",
    value: input.value
  })) && input.value.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Board",
    value: elem
  })) && _vo1(elem, _path + ".value[" + _index2 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Board",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Board>",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.ownerId === "string" || _report(_exceptionable, {
    path: _path + ".ownerId",
    expected: "string",
    value: input.ownerId
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 401 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "401",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Array<Board>, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<Array<Board>, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<Array<Board>, OK>)",
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
var validateGetBoardPathParams = (() => {
  const _io0 = (input) => typeof input.boardId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
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
        expected: "GetBoard.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetBoard.PathParams",
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
var validateGetBoardPathQuery = (() => {
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
        expected: "GetBoard.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetBoard.PathQuery",
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
var validateGetBoardBody = (() => {
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
        expected: "GetBoard.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetBoard.Body",
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
var validateGetBoardResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && typeof input.ownerId === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string" && (Array.isArray(input.lists) && input.lists.every((elem) => typeof elem === "object" && elem !== null && _io2(elem)));
  const _io2 = (input) => typeof input.id === "string" && typeof input.boardId === "string" && typeof input.name === "string" && typeof input.position === "number" && typeof input.createdAt === "string" && (Array.isArray(input.cards) && input.cards.every((elem) => typeof elem === "object" && elem !== null && _io3(elem)));
  const _io3 = (input) => typeof input.id === "string" && typeof input.listId === "string" && typeof input.boardId === "string" && typeof input.title === "string" && typeof input.description === "string" && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io4 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io5(input.error)) && input.statusCode === 404;
  const _io5 = (input) => input.type === "BoardNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io4(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "BoardWithContents",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "BoardWithContents",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.ownerId === "string" || _report(_exceptionable, {
    path: _path + ".ownerId",
    expected: "string",
    value: input.ownerId
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  }), (Array.isArray(input.lists) || _report(_exceptionable, {
    path: _path + ".lists",
    expected: "Array<BoardListWithCards>",
    value: input.lists
  })) && input.lists.map((elem, _index3) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".lists[" + _index3 + "]",
    expected: "BoardListWithCards",
    value: elem
  })) && _vo2(elem, _path + ".lists[" + _index3 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".lists[" + _index3 + "]",
    expected: "BoardListWithCards",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".lists",
    expected: "Array<BoardListWithCards>",
    value: input.lists
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), (Array.isArray(input.cards) || _report(_exceptionable, {
    path: _path + ".cards",
    expected: "Array<Card>",
    value: input.cards
  })) && input.cards.map((elem, _index4) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".cards[" + _index4 + "]",
    expected: "Card",
    value: elem
  })) && _vo3(elem, _path + ".cards[" + _index4 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".cards[" + _index4 + "]",
    expected: "Card",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".cards",
    expected: "Array<Card>",
    value: input.cards
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "string",
    value: input.listId
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo4 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo5(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo5 = (input, _path, _exceptionable = true) => [input.type === "BoardNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"BoardNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo4(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<BoardWithContents, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<BoardWithContents, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<BoardWithContents, OK>)",
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
var validateCreateBoardPathParams = (() => {
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
        expected: "CreateBoard.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateBoard.PathParams",
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
var validateCreateBoardPathQuery = (() => {
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
        expected: "CreateBoard.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateBoard.PathQuery",
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
var validateCreateBoardBody = (() => {
  const _io0 = (input) => typeof input.name === "string" && typeof input.description === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
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
        expected: "CreateBoardRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateBoardRequest",
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
var validateCreateBoardResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 201;
  const _io1 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && typeof input.ownerId === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 401;
  const _io3 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Board",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Board",
    value: input.value
  }), input.statusCode === 201 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "201",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.ownerId === "string" || _report(_exceptionable, {
    path: _path + ".ownerId",
    expected: "string",
    value: input.ownerId
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 401 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "401",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Board, CREATED> | SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<Board, CREATED>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<Board, CREATED>)",
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
var validateCreateListPathParams = (() => {
  const _io0 = (input) => typeof input.boardId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
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
        expected: "CreateList.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateList.PathParams",
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
var validateCreateListPathQuery = (() => {
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
        expected: "CreateList.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateList.PathQuery",
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
var validateCreateListBody = (() => {
  const _io0 = (input) => typeof input.name === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
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
        expected: "CreateListRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateListRequest",
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
var validateCreateListResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 201;
  const _io1 = (input) => typeof input.id === "string" && typeof input.boardId === "string" && typeof input.name === "string" && typeof input.position === "number" && typeof input.createdAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "BoardNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "BoardList",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "BoardList",
    value: input.value
  }), input.statusCode === 201 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "201",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "BoardNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"BoardNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<BoardList, CREATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<BoardList, CREATED>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<BoardList, CREATED>)",
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
var validateCreateCardPathParams = (() => {
  const _io0 = (input) => typeof input.boardId === "string" && typeof input.listId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "string",
    value: input.listId
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
        expected: "CreateCard.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateCard.PathParams",
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
var validateCreateCardPathQuery = (() => {
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
        expected: "CreateCard.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateCard.PathQuery",
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
var validateCreateCardBody = (() => {
  const _io0 = (input) => typeof input.title === "string" && typeof input.description === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
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
        expected: "CreateCardRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateCardRequest",
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
var validateCreateCardResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 201;
  const _io1 = (input) => typeof input.id === "string" && typeof input.listId === "string" && typeof input.boardId === "string" && typeof input.title === "string" && typeof input.description === "string" && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "ListNotFound";
  const _io4 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io5(input.error)) && input.statusCode === 401;
  const _io5 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.statusCode === 401)
      return _io4(input);
    else if (input.statusCode === 404)
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Card",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Card",
    value: input.value
  }), input.statusCode === 201 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "201",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "string",
    value: input.listId
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "ListNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"ListNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vo4 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  })) && _vo5(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  }), input.statusCode === 401 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "401",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo5 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.statusCode === 401)
      return _vo4(input, _path, _exceptionable);
    else if (input.statusCode === 404)
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Card, CREATED> | SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Card, CREATED>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Card, CREATED>)",
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
var validateUpdateCardPathParams = (() => {
  const _io0 = (input) => typeof input.boardId === "string" && typeof input.cardId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.cardId === "string" || _report(_exceptionable, {
    path: _path + ".cardId",
    expected: "string",
    value: input.cardId
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
        expected: "UpdateCard.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "UpdateCard.PathParams",
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
var validateUpdateCardPathQuery = (() => {
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
        expected: "UpdateCard.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "UpdateCard.PathQuery",
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
var validateUpdateCardBody = (() => {
  const _io0 = (input) => (input.title === undefined || typeof input.title === "string") && (input.description === undefined || typeof input.description === "string");
  const _vo0 = (input, _path, _exceptionable = true) => [input.title === undefined || typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "(string | undefined)",
    value: input.title
  }), input.description === undefined || typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "(string | undefined)",
    value: input.description
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && Array.isArray(input) === false && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null && Array.isArray(input2) === false || _report(true, {
        path: _path + "",
        expected: "UpdateCardRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "UpdateCardRequest",
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
var validateUpdateCardResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.listId === "string" && typeof input.boardId === "string" && typeof input.title === "string" && typeof input.description === "string" && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "CardNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Card",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Card",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "string",
    value: input.listId
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "CardNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"CardNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Card, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Card, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Card, OK>)",
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
var validateMoveCardPathParams = (() => {
  const _io0 = (input) => typeof input.boardId === "string" && typeof input.cardId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.cardId === "string" || _report(_exceptionable, {
    path: _path + ".cardId",
    expected: "string",
    value: input.cardId
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
        expected: "MoveCard.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "MoveCard.PathParams",
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
var validateMoveCardPathQuery = (() => {
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
        expected: "MoveCard.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "MoveCard.PathQuery",
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
var validateMoveCardBody = (() => {
  const _io0 = (input) => typeof input.toListId === "string" && typeof input.position === "number";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.toListId === "string" || _report(_exceptionable, {
    path: _path + ".toListId",
    expected: "string",
    value: input.toListId
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
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
        expected: "MoveCardRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "MoveCardRequest",
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
var validateMoveCardResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.listId === "string" && typeof input.boardId === "string" && typeof input.title === "string" && typeof input.description === "string" && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "CardNotFound";
  const _io4 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io5(input.error)) && input.statusCode === 404;
  const _io5 = (input) => input.type === "ListNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else
      return (() => {
        if (_io4(input))
          return _io4(input);
        if (_io2(input))
          return _io2(input);
        return false;
      })();
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Card",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Card",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "string",
    value: input.listId
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "CardNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"CardNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vo4 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  })) && _vo5(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo5 = (input, _path, _exceptionable = true) => [input.type === "ListNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"ListNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else
      return _vo4(input, _path, false) || _vo2(input, _path, false);
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>.o1 | SerializableResult.OkWithStatusCode<Card, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>.o1 | SerializableResult.OkWithStatusCode<Card, OK>)",
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
var validateDeleteCardPathParams = (() => {
  const _io0 = (input) => typeof input.boardId === "string" && typeof input.cardId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.cardId === "string" || _report(_exceptionable, {
    path: _path + ".cardId",
    expected: "string",
    value: input.cardId
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
        expected: "DeleteCard.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "DeleteCard.PathParams",
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
var validateDeleteCardPathQuery = (() => {
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
        expected: "DeleteCard.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "DeleteCard.PathQuery",
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
var validateDeleteCardBody = (() => {
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
        expected: "DeleteCard.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "DeleteCard.Body",
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
var validateDeleteCardResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => input.success === true;
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "CardNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "__type",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "__type",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.success === true || _report(_exceptionable, {
    path: _path + ".success",
    expected: "true",
    value: input.success
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "CardNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"CardNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<__type, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<__type, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<__type, OK>)",
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
var validateTask = (() => {
  const _io0 = (input) => input.type === "Task" && typeof input.id === "string" && typeof input.boardId === "string" && (input.listId === undefined || typeof input.listId === "string") && typeof input.title === "string" && typeof input.description === "string" && (input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === "low" || input.priority === "medium" || input.priority === "high") && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Task" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Task"',
    value: input.type
  }), typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo")',
    value: input.status
  }), input.priority === "low" || input.priority === "medium" || input.priority === "high" || _report(_exceptionable, {
    path: _path + ".priority",
    expected: '("high" | "low" | "medium")',
    value: input.priority
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
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
        expected: "Task",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Task",
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
var isTask = (() => {
  const _io0 = (input) => input.type === "Task" && typeof input.id === "string" && typeof input.boardId === "string" && (input.listId === undefined || typeof input.listId === "string") && typeof input.title === "string" && typeof input.description === "string" && (input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === "low" || input.priority === "medium" || input.priority === "high") && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  return (input) => typeof input === "object" && input !== null && _io0(input);
})();
var validateTasksLoaderResponse = (() => {
  const _io0 = (input) => input.type === "Task" && typeof input.id === "string" && typeof input.boardId === "string" && (input.listId === undefined || typeof input.listId === "string") && typeof input.title === "string" && typeof input.description === "string" && (input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === "low" || input.priority === "medium" || input.priority === "high") && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Task" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Task"',
    value: input.type
  }), typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo")',
    value: input.status
  }), input.priority === "low" || input.priority === "medium" || input.priority === "high" || _report(_exceptionable, {
    path: _path + ".priority",
    expected: '("high" | "low" | "medium")',
    value: input.priority
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const __is = (input) => Array.isArray(input) && input.every((elem) => typeof elem === "object" && elem !== null && _io0(elem));
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (Array.isArray(input2) || _report(true, {
        path: _path + "",
        expected: "Array<Task>",
        value: input2
      })) && input2.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(true, {
        path: _path + "[" + _index2 + "]",
        expected: "Task",
        value: elem
      })) && _vo0(elem, _path + "[" + _index2 + "]", true) || _report(true, {
        path: _path + "[" + _index2 + "]",
        expected: "Task",
        value: elem
      })).every((flag) => flag) || _report(true, {
        path: _path + "",
        expected: "Array<Task>",
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
var validateListTasksPathParams = (() => {
  const _io0 = (input) => typeof input.boardId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
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
        expected: "ListTasks.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListTasks.PathParams",
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
var validateListTasksPathQuery = (() => {
  const _io0 = (input) => (input.listId === undefined || typeof input.listId === "string") && (input.status === undefined || input.status === "todo" || input.status === "in-progress" || input.status === "done");
  const _vo0 = (input, _path, _exceptionable = true) => [input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), input.status === undefined || input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo" | undefined)',
    value: input.status
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && Array.isArray(input) === false && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null && Array.isArray(input2) === false || _report(true, {
        path: _path + "",
        expected: "ListTasks.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListTasks.PathQuery",
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
var validateListTasksBody = (() => {
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
        expected: "ListTasks.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListTasks.Body",
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
var validateListTasksResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (Array.isArray(input.value) && input.value.every((elem) => typeof elem === "object" && elem !== null && _io1(elem))) && input.statusCode === 200;
  const _io1 = (input) => input.type === "Task" && typeof input.id === "string" && typeof input.boardId === "string" && (input.listId === undefined || typeof input.listId === "string") && typeof input.title === "string" && typeof input.description === "string" && (input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === "low" || input.priority === "medium" || input.priority === "high") && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 401;
  const _io3 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (Array.isArray(input.value) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Task>",
    value: input.value
  })) && input.value.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Task",
    value: elem
  })) && _vo1(elem, _path + ".value[" + _index2 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Task",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Task>",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.type === "Task" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Task"',
    value: input.type
  }), typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo")',
    value: input.status
  }), input.priority === "low" || input.priority === "medium" || input.priority === "high" || _report(_exceptionable, {
    path: _path + ".priority",
    expected: '("high" | "low" | "medium")',
    value: input.priority
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 401 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "401",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Array<Task>, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<Array<Task>, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<Array<Task>, OK>)",
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
var validateListAllTasksPathParams = (() => {
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
        expected: "ListAllTasks.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListAllTasks.PathParams",
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
var validateListAllTasksPathQuery = (() => {
  const _io0 = (input) => input.limit === undefined || typeof input.limit === "number";
  const _vo0 = (input, _path, _exceptionable = true) => [input.limit === undefined || typeof input.limit === "number" || _report(_exceptionable, {
    path: _path + ".limit",
    expected: "(number | undefined)",
    value: input.limit
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && Array.isArray(input) === false && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null && Array.isArray(input2) === false || _report(true, {
        path: _path + "",
        expected: "ListAllTasks.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListAllTasks.PathQuery",
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
var validateListAllTasksBody = (() => {
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
        expected: "ListAllTasks.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListAllTasks.Body",
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
var validateListAllTasksResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (Array.isArray(input.value) && input.value.every((elem) => typeof elem === "object" && elem !== null && _io1(elem))) && input.statusCode === 200;
  const _io1 = (input) => input.type === "Task" && typeof input.id === "string" && typeof input.boardId === "string" && (input.listId === undefined || typeof input.listId === "string") && typeof input.title === "string" && typeof input.description === "string" && (input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === "low" || input.priority === "medium" || input.priority === "high") && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (Array.isArray(input.value) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Task>",
    value: input.value
  })) && input.value.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Task",
    value: elem
  })) && _vo1(elem, _path + ".value[" + _index2 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Task",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Task>",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.type === "Task" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Task"',
    value: input.type
  }), typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo")',
    value: input.status
  }), input.priority === "low" || input.priority === "medium" || input.priority === "high" || _report(_exceptionable, {
    path: _path + ".priority",
    expected: '("high" | "low" | "medium")',
    value: input.priority
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
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
        expected: "ListAllTasks.Response",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListAllTasks.Response",
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
var validateGetTaskPathParams = (() => {
  const _io0 = (input) => typeof input.taskId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.taskId === "string" || _report(_exceptionable, {
    path: _path + ".taskId",
    expected: "string",
    value: input.taskId
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
        expected: "GetTask.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetTask.PathParams",
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
var validateGetTaskPathQuery = (() => {
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
        expected: "GetTask.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetTask.PathQuery",
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
var validateGetTaskBody = (() => {
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
        expected: "GetTask.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetTask.Body",
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
var validateGetTaskResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => input.type === "Task" && typeof input.id === "string" && typeof input.boardId === "string" && (input.listId === undefined || typeof input.listId === "string") && typeof input.title === "string" && typeof input.description === "string" && (input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === "low" || input.priority === "medium" || input.priority === "high") && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "TaskNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Task",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Task",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.type === "Task" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Task"',
    value: input.type
  }), typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo")',
    value: input.status
  }), input.priority === "low" || input.priority === "medium" || input.priority === "high" || _report(_exceptionable, {
    path: _path + ".priority",
    expected: '("high" | "low" | "medium")',
    value: input.priority
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "TaskNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"TaskNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Task, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Task, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Task, OK>)",
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
var validateCreateTaskPathParams = (() => {
  const _io0 = (input) => typeof input.boardId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
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
        expected: "CreateTask.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateTask.PathParams",
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
var validateCreateTaskPathQuery = (() => {
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
        expected: "CreateTask.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateTask.PathQuery",
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
var validateCreateTaskBody = (() => {
  const _io0 = (input) => typeof input.title === "string" && typeof input.description === "string" && (input.listId === undefined || typeof input.listId === "string") && (input.status === undefined || input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === undefined || input.priority === "low" || input.priority === "medium" || input.priority === "high");
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), input.status === undefined || input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo" | undefined)',
    value: input.status
  }), input.priority === undefined || input.priority === "low" || input.priority === "medium" || input.priority === "high" || _report(_exceptionable, {
    path: _path + ".priority",
    expected: '("high" | "low" | "medium" | undefined)',
    value: input.priority
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
        expected: "CreateTaskRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateTaskRequest",
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
var validateCreateTaskResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 201;
  const _io1 = (input) => input.type === "Task" && typeof input.id === "string" && typeof input.boardId === "string" && (input.listId === undefined || typeof input.listId === "string") && typeof input.title === "string" && typeof input.description === "string" && (input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === "low" || input.priority === "medium" || input.priority === "high") && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "BoardNotFound";
  const _io4 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io5(input.error)) && input.statusCode === 401;
  const _io5 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.statusCode === 401)
      return _io4(input);
    else if (input.statusCode === 404)
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Task",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Task",
    value: input.value
  }), input.statusCode === 201 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "201",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.type === "Task" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Task"',
    value: input.type
  }), typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo")',
    value: input.status
  }), input.priority === "low" || input.priority === "medium" || input.priority === "high" || _report(_exceptionable, {
    path: _path + ".priority",
    expected: '("high" | "low" | "medium")',
    value: input.priority
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "BoardNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"BoardNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vo4 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  })) && _vo5(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  }), input.statusCode === 401 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "401",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo5 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.statusCode === 401)
      return _vo4(input, _path, _exceptionable);
    else if (input.statusCode === 404)
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Task, CREATED> | SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Task, CREATED>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Task, CREATED>)",
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
var validateUpdateTaskPathParams = (() => {
  const _io0 = (input) => typeof input.taskId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.taskId === "string" || _report(_exceptionable, {
    path: _path + ".taskId",
    expected: "string",
    value: input.taskId
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
        expected: "UpdateTask.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "UpdateTask.PathParams",
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
var validateUpdateTaskPathQuery = (() => {
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
        expected: "UpdateTask.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "UpdateTask.PathQuery",
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
var validateUpdateTaskBody = (() => {
  const _io0 = (input) => (input.title === undefined || typeof input.title === "string") && (input.description === undefined || typeof input.description === "string") && (input.listId === undefined || typeof input.listId === "string") && (input.status === undefined || input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === undefined || input.priority === "low" || input.priority === "medium" || input.priority === "high") && (input.position === undefined || typeof input.position === "number");
  const _vo0 = (input, _path, _exceptionable = true) => [input.title === undefined || typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "(string | undefined)",
    value: input.title
  }), input.description === undefined || typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "(string | undefined)",
    value: input.description
  }), input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), input.status === undefined || input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo" | undefined)',
    value: input.status
  }), input.priority === undefined || input.priority === "low" || input.priority === "medium" || input.priority === "high" || _report(_exceptionable, {
    path: _path + ".priority",
    expected: '("high" | "low" | "medium" | undefined)',
    value: input.priority
  }), input.position === undefined || typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "(number | undefined)",
    value: input.position
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && Array.isArray(input) === false && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null && Array.isArray(input2) === false || _report(true, {
        path: _path + "",
        expected: "UpdateTaskRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "UpdateTaskRequest",
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
var validateUpdateTaskResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => input.type === "Task" && typeof input.id === "string" && typeof input.boardId === "string" && (input.listId === undefined || typeof input.listId === "string") && typeof input.title === "string" && typeof input.description === "string" && (input.status === "todo" || input.status === "in-progress" || input.status === "done") && (input.priority === "low" || input.priority === "medium" || input.priority === "high") && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "TaskNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Task",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Task",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.type === "Task" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Task"',
    value: input.type
  }), typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), input.listId === undefined || typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "(string | undefined)",
    value: input.listId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.status === "todo" || input.status === "in-progress" || input.status === "done" || _report(_exceptionable, {
    path: _path + ".status",
    expected: '("done" | "in-progress" | "todo")',
    value: input.status
  }), input.priority === "low" || input.priority === "medium" || input.priority === "high" || _report(_exceptionable, {
    path: _path + ".priority",
    expected: '("high" | "low" | "medium")',
    value: input.priority
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "TaskNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"TaskNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Task, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Task, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Task, OK>)",
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
var validateDeleteTaskPathParams = (() => {
  const _io0 = (input) => typeof input.taskId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.taskId === "string" || _report(_exceptionable, {
    path: _path + ".taskId",
    expected: "string",
    value: input.taskId
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
        expected: "DeleteTask.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "DeleteTask.PathParams",
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
var validateDeleteTaskPathQuery = (() => {
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
        expected: "DeleteTask.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "DeleteTask.PathQuery",
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
var validateDeleteTaskBody = (() => {
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
        expected: "DeleteTask.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "DeleteTask.Body",
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
var validateDeleteTaskResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => input.success === true;
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "TaskNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "__type",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "__type",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.success === true || _report(_exceptionable, {
    path: _path + ".success",
    expected: "true",
    value: input.success
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "TaskNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"TaskNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<__type, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<__type, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<__type, OK>)",
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
var validateListChannelsPathParams = (() => {
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
        expected: "ListChannels.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListChannels.PathParams",
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
var validateListChannelsPathQuery = (() => {
  const _io0 = (input) => input.boardId === undefined || typeof input.boardId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [input.boardId === undefined || typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "(string | undefined)",
    value: input.boardId
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && Array.isArray(input) === false && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null && Array.isArray(input2) === false || _report(true, {
        path: _path + "",
        expected: "ListChannels.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListChannels.PathQuery",
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
var validateListChannelsBody = (() => {
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
        expected: "ListChannels.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListChannels.Body",
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
var validateListChannelsResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (Array.isArray(input.value) && input.value.every((elem) => typeof elem === "object" && elem !== null && _io1(elem))) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && (input.boardId === null || typeof input.boardId === "string") && typeof input.createdBy === "string" && typeof input.createdAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (Array.isArray(input.value) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Channel>",
    value: input.value
  })) && input.value.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Channel",
    value: elem
  })) && _vo1(elem, _path + ".value[" + _index2 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Channel",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Channel>",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.boardId === null || typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "(null | string)",
    value: input.boardId
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
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
        expected: "ListChannels.Response",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListChannels.Response",
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
var validateGetChannelPathParams = (() => {
  const _io0 = (input) => typeof input.channelId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.channelId === "string" || _report(_exceptionable, {
    path: _path + ".channelId",
    expected: "string",
    value: input.channelId
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
        expected: "GetChannel.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetChannel.PathParams",
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
var validateGetChannelPathQuery = (() => {
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
        expected: "GetChannel.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetChannel.PathQuery",
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
var validateGetChannelBody = (() => {
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
        expected: "GetChannel.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetChannel.Body",
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
var validateGetChannelResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && (input.boardId === null || typeof input.boardId === "string") && typeof input.createdBy === "string" && typeof input.createdAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "ChannelNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Channel",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Channel",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.boardId === null || typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "(null | string)",
    value: input.boardId
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "ChannelNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"ChannelNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Channel, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Channel, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Channel, OK>)",
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
var validateCreateChannelPathParams = (() => {
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
        expected: "CreateChannel.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateChannel.PathParams",
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
var validateCreateChannelPathQuery = (() => {
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
        expected: "CreateChannel.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateChannel.PathQuery",
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
var validateCreateChannelBody = (() => {
  const _io0 = (input) => typeof input.name === "string" && typeof input.description === "string" && (input.boardId === undefined || typeof input.boardId === "string");
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.boardId === undefined || typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "(string | undefined)",
    value: input.boardId
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
        expected: "CreateChannelRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateChannelRequest",
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
var validateCreateChannelResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 201;
  const _io1 = (input) => typeof input.id === "string" && typeof input.name === "string" && typeof input.description === "string" && (input.boardId === null || typeof input.boardId === "string") && typeof input.createdBy === "string" && typeof input.createdAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 401;
  const _io3 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Channel",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Channel",
    value: input.value
  }), input.statusCode === 201 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "201",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), input.boardId === null || typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "(null | string)",
    value: input.boardId
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 401 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "401",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Channel, CREATED> | SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<Channel, CREATED>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<Channel, CREATED>)",
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
var validateGetMessagesPathParams = (() => {
  const _io0 = (input) => typeof input.channelId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.channelId === "string" || _report(_exceptionable, {
    path: _path + ".channelId",
    expected: "string",
    value: input.channelId
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
        expected: "GetMessages.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetMessages.PathParams",
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
var validateGetMessagesPathQuery = (() => {
  const _io0 = (input) => (input.limit === undefined || typeof input.limit === "number") && (input.before === undefined || typeof input.before === "string");
  const _vo0 = (input, _path, _exceptionable = true) => [input.limit === undefined || typeof input.limit === "number" || _report(_exceptionable, {
    path: _path + ".limit",
    expected: "(number | undefined)",
    value: input.limit
  }), input.before === undefined || typeof input.before === "string" || _report(_exceptionable, {
    path: _path + ".before",
    expected: "(string | undefined)",
    value: input.before
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && Array.isArray(input) === false && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null && Array.isArray(input2) === false || _report(true, {
        path: _path + "",
        expected: "GetMessages.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetMessages.PathQuery",
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
var validateGetMessagesBody = (() => {
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
        expected: "GetMessages.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetMessages.Body",
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
var validateGetMessagesResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (Array.isArray(input.value) && input.value.every((elem) => typeof elem === "object" && elem !== null && _io1(elem))) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.channelId === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "ChannelNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (Array.isArray(input.value) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Message>",
    value: input.value
  })) && input.value.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Message",
    value: elem
  })) && _vo1(elem, _path + ".value[" + _index2 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "Message",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<Message>",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.channelId === "string" || _report(_exceptionable, {
    path: _path + ".channelId",
    expected: "string",
    value: input.channelId
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "ChannelNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"ChannelNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Array<Message>, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Array<Message>, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Array<Message>, OK>)",
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
var validateSendMessagePathParams = (() => {
  const _io0 = (input) => typeof input.channelId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.channelId === "string" || _report(_exceptionable, {
    path: _path + ".channelId",
    expected: "string",
    value: input.channelId
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
        expected: "SendMessage.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "SendMessage.PathParams",
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
var validateSendMessagePathQuery = (() => {
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
        expected: "SendMessage.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "SendMessage.PathQuery",
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
var validateSendMessageBody = (() => {
  const _io0 = (input) => typeof input.content === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
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
        expected: "SendMessageRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "SendMessageRequest",
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
var validateSendMessageResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 201;
  const _io1 = (input) => typeof input.id === "string" && typeof input.channelId === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "ChannelNotFound";
  const _io4 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io5(input.error)) && input.statusCode === 401;
  const _io5 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.statusCode === 401)
      return _io4(input);
    else if (input.statusCode === 404)
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Message",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Message",
    value: input.value
  }), input.statusCode === 201 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "201",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.channelId === "string" || _report(_exceptionable, {
    path: _path + ".channelId",
    expected: "string",
    value: input.channelId
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "ChannelNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"ChannelNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vo4 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  })) && _vo5(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type.o1",
    value: input.error
  }), input.statusCode === 401 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "401",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo5 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.statusCode === 401)
      return _vo4(input, _path, _exceptionable);
    else if (input.statusCode === 404)
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<Message, CREATED> | SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Message, CREATED>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<Message, CREATED>)",
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
var validateBoardUpdatesPathParams = (() => {
  const _io0 = (input) => typeof input.boardId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
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
        expected: "BoardUpdates.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "BoardUpdates.PathParams",
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
var validateBoardUpdatesPathQuery = (() => {
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
        expected: "BoardUpdates.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "BoardUpdates.PathQuery",
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
var validateBoardUpdatesEvents = (() => {
  const _io0 = (input) => (input.card_created === undefined || typeof input.card_created === "object" && input.card_created !== null && _io1(input.card_created)) && (input.card_updated === undefined || typeof input.card_updated === "object" && input.card_updated !== null && _io3(input.card_updated)) && (input.card_moved === undefined || typeof input.card_moved === "object" && input.card_moved !== null && _io4(input.card_moved)) && (input.card_deleted === undefined || typeof input.card_deleted === "object" && input.card_deleted !== null && _io5(input.card_deleted)) && (input.list_created === undefined || typeof input.list_created === "object" && input.list_created !== null && _io6(input.list_created)) && (input.list_updated === undefined || typeof input.list_updated === "object" && input.list_updated !== null && _io8(input.list_updated)) && (input.list_deleted === undefined || typeof input.list_deleted === "object" && input.list_deleted !== null && _io9(input.list_deleted));
  const _io1 = (input) => typeof input.card === "object" && input.card !== null && _io2(input.card);
  const _io2 = (input) => typeof input.id === "string" && typeof input.listId === "string" && typeof input.boardId === "string" && typeof input.title === "string" && typeof input.description === "string" && typeof input.position === "number" && typeof input.createdBy === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io3 = (input) => typeof input.card === "object" && input.card !== null && _io2(input.card);
  const _io4 = (input) => typeof input.cardId === "string" && typeof input.fromListId === "string" && typeof input.toListId === "string" && typeof input.position === "number";
  const _io5 = (input) => typeof input.cardId === "string";
  const _io6 = (input) => typeof input.list === "object" && input.list !== null && _io7(input.list);
  const _io7 = (input) => typeof input.id === "string" && typeof input.boardId === "string" && typeof input.name === "string" && typeof input.position === "number" && typeof input.createdAt === "string";
  const _io8 = (input) => typeof input.list === "object" && input.list !== null && _io7(input.list);
  const _io9 = (input) => typeof input.listId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [input.card_created === undefined || (typeof input.card_created === "object" && input.card_created !== null || _report(_exceptionable, {
    path: _path + ".card_created",
    expected: "(__type | undefined)",
    value: input.card_created
  })) && _vo1(input.card_created, _path + ".card_created", _exceptionable) || _report(_exceptionable, {
    path: _path + ".card_created",
    expected: "(__type | undefined)",
    value: input.card_created
  }), input.card_updated === undefined || (typeof input.card_updated === "object" && input.card_updated !== null || _report(_exceptionable, {
    path: _path + ".card_updated",
    expected: "(__type.o1 | undefined)",
    value: input.card_updated
  })) && _vo3(input.card_updated, _path + ".card_updated", _exceptionable) || _report(_exceptionable, {
    path: _path + ".card_updated",
    expected: "(__type.o1 | undefined)",
    value: input.card_updated
  }), input.card_moved === undefined || (typeof input.card_moved === "object" && input.card_moved !== null || _report(_exceptionable, {
    path: _path + ".card_moved",
    expected: "(__type.o2 | undefined)",
    value: input.card_moved
  })) && _vo4(input.card_moved, _path + ".card_moved", _exceptionable) || _report(_exceptionable, {
    path: _path + ".card_moved",
    expected: "(__type.o2 | undefined)",
    value: input.card_moved
  }), input.card_deleted === undefined || (typeof input.card_deleted === "object" && input.card_deleted !== null || _report(_exceptionable, {
    path: _path + ".card_deleted",
    expected: "(__type.o3 | undefined)",
    value: input.card_deleted
  })) && _vo5(input.card_deleted, _path + ".card_deleted", _exceptionable) || _report(_exceptionable, {
    path: _path + ".card_deleted",
    expected: "(__type.o3 | undefined)",
    value: input.card_deleted
  }), input.list_created === undefined || (typeof input.list_created === "object" && input.list_created !== null || _report(_exceptionable, {
    path: _path + ".list_created",
    expected: "(__type.o4 | undefined)",
    value: input.list_created
  })) && _vo6(input.list_created, _path + ".list_created", _exceptionable) || _report(_exceptionable, {
    path: _path + ".list_created",
    expected: "(__type.o4 | undefined)",
    value: input.list_created
  }), input.list_updated === undefined || (typeof input.list_updated === "object" && input.list_updated !== null || _report(_exceptionable, {
    path: _path + ".list_updated",
    expected: "(__type.o5 | undefined)",
    value: input.list_updated
  })) && _vo8(input.list_updated, _path + ".list_updated", _exceptionable) || _report(_exceptionable, {
    path: _path + ".list_updated",
    expected: "(__type.o5 | undefined)",
    value: input.list_updated
  }), input.list_deleted === undefined || (typeof input.list_deleted === "object" && input.list_deleted !== null || _report(_exceptionable, {
    path: _path + ".list_deleted",
    expected: "(__type.o6 | undefined)",
    value: input.list_deleted
  })) && _vo9(input.list_deleted, _path + ".list_deleted", _exceptionable) || _report(_exceptionable, {
    path: _path + ".list_deleted",
    expected: "(__type.o6 | undefined)",
    value: input.list_deleted
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [(typeof input.card === "object" && input.card !== null || _report(_exceptionable, {
    path: _path + ".card",
    expected: "Card",
    value: input.card
  })) && _vo2(input.card, _path + ".card", _exceptionable) || _report(_exceptionable, {
    path: _path + ".card",
    expected: "Card",
    value: input.card
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "string",
    value: input.listId
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.description === "string" || _report(_exceptionable, {
    path: _path + ".description",
    expected: "string",
    value: input.description
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdBy === "string" || _report(_exceptionable, {
    path: _path + ".createdBy",
    expected: "string",
    value: input.createdBy
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [(typeof input.card === "object" && input.card !== null || _report(_exceptionable, {
    path: _path + ".card",
    expected: "Card",
    value: input.card
  })) && _vo2(input.card, _path + ".card", _exceptionable) || _report(_exceptionable, {
    path: _path + ".card",
    expected: "Card",
    value: input.card
  })].every((flag) => flag);
  const _vo4 = (input, _path, _exceptionable = true) => [typeof input.cardId === "string" || _report(_exceptionable, {
    path: _path + ".cardId",
    expected: "string",
    value: input.cardId
  }), typeof input.fromListId === "string" || _report(_exceptionable, {
    path: _path + ".fromListId",
    expected: "string",
    value: input.fromListId
  }), typeof input.toListId === "string" || _report(_exceptionable, {
    path: _path + ".toListId",
    expected: "string",
    value: input.toListId
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  })].every((flag) => flag);
  const _vo5 = (input, _path, _exceptionable = true) => [typeof input.cardId === "string" || _report(_exceptionable, {
    path: _path + ".cardId",
    expected: "string",
    value: input.cardId
  })].every((flag) => flag);
  const _vo6 = (input, _path, _exceptionable = true) => [(typeof input.list === "object" && input.list !== null || _report(_exceptionable, {
    path: _path + ".list",
    expected: "BoardList",
    value: input.list
  })) && _vo7(input.list, _path + ".list", _exceptionable) || _report(_exceptionable, {
    path: _path + ".list",
    expected: "BoardList",
    value: input.list
  })].every((flag) => flag);
  const _vo7 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.boardId === "string" || _report(_exceptionable, {
    path: _path + ".boardId",
    expected: "string",
    value: input.boardId
  }), typeof input.name === "string" || _report(_exceptionable, {
    path: _path + ".name",
    expected: "string",
    value: input.name
  }), typeof input.position === "number" || _report(_exceptionable, {
    path: _path + ".position",
    expected: "number",
    value: input.position
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const _vo8 = (input, _path, _exceptionable = true) => [(typeof input.list === "object" && input.list !== null || _report(_exceptionable, {
    path: _path + ".list",
    expected: "BoardList",
    value: input.list
  })) && _vo7(input.list, _path + ".list", _exceptionable) || _report(_exceptionable, {
    path: _path + ".list",
    expected: "BoardList",
    value: input.list
  })].every((flag) => flag);
  const _vo9 = (input, _path, _exceptionable = true) => [typeof input.listId === "string" || _report(_exceptionable, {
    path: _path + ".listId",
    expected: "string",
    value: input.listId
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && Array.isArray(input) === false && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null && Array.isArray(input2) === false || _report(true, {
        path: _path + "",
        expected: "Partial<BoardUpdates.Events>",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Partial<BoardUpdates.Events>",
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
var validateBoardUpdatesCompletionData = (() => {
  const _io0 = (input) => input.reason === "board_deleted" || input.reason === "disconnected";
  const _vo0 = (input, _path, _exceptionable = true) => [input.reason === "board_deleted" || input.reason === "disconnected" || _report(_exceptionable, {
    path: _path + ".reason",
    expected: '("board_deleted" | "disconnected")',
    value: input.reason
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
        expected: "BoardUpdates.CompletionData",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "BoardUpdates.CompletionData",
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
var validateBoardUpdatesCompletionError = (() => {
  const _io0 = (input) => input.type === "BoardNotFound";
  const _io1 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Unauthorized")
      return _io1(input);
    else if (input.type === "BoardNotFound")
      return _io0(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "BoardNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"BoardNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Unauthorized")
      return _vo1(input, _path, _exceptionable);
    else if (input.type === "BoardNotFound")
      return _vo0(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(__type.o1 | __type)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(__type | __type.o1)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(__type | __type.o1)",
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
var validateChatMessagesPathParams = (() => {
  const _io0 = (input) => typeof input.channelId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.channelId === "string" || _report(_exceptionable, {
    path: _path + ".channelId",
    expected: "string",
    value: input.channelId
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
        expected: "ChatMessages.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ChatMessages.PathParams",
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
var validateChatMessagesPathQuery = (() => {
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
        expected: "ChatMessages.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ChatMessages.PathQuery",
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
var validateChatMessagesEvents = (() => {
  const _io0 = (input) => (input.message_created === undefined || typeof input.message_created === "object" && input.message_created !== null && _io1(input.message_created)) && (input.message_deleted === undefined || typeof input.message_deleted === "object" && input.message_deleted !== null && _io3(input.message_deleted)) && (input.typing_started === undefined || typeof input.typing_started === "object" && input.typing_started !== null && _io4(input.typing_started)) && (input.typing_stopped === undefined || typeof input.typing_stopped === "object" && input.typing_stopped !== null && _io5(input.typing_stopped));
  const _io1 = (input) => typeof input.message === "object" && input.message !== null && _io2(input.message);
  const _io2 = (input) => typeof input.id === "string" && typeof input.channelId === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string";
  const _io3 = (input) => typeof input.messageId === "string";
  const _io4 = (input) => typeof input.userId === "string" && typeof input.username === "string";
  const _io5 = (input) => typeof input.userId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [input.message_created === undefined || (typeof input.message_created === "object" && input.message_created !== null || _report(_exceptionable, {
    path: _path + ".message_created",
    expected: "(__type | undefined)",
    value: input.message_created
  })) && _vo1(input.message_created, _path + ".message_created", _exceptionable) || _report(_exceptionable, {
    path: _path + ".message_created",
    expected: "(__type | undefined)",
    value: input.message_created
  }), input.message_deleted === undefined || (typeof input.message_deleted === "object" && input.message_deleted !== null || _report(_exceptionable, {
    path: _path + ".message_deleted",
    expected: "(__type.o1 | undefined)",
    value: input.message_deleted
  })) && _vo3(input.message_deleted, _path + ".message_deleted", _exceptionable) || _report(_exceptionable, {
    path: _path + ".message_deleted",
    expected: "(__type.o1 | undefined)",
    value: input.message_deleted
  }), input.typing_started === undefined || (typeof input.typing_started === "object" && input.typing_started !== null || _report(_exceptionable, {
    path: _path + ".typing_started",
    expected: "(__type.o2 | undefined)",
    value: input.typing_started
  })) && _vo4(input.typing_started, _path + ".typing_started", _exceptionable) || _report(_exceptionable, {
    path: _path + ".typing_started",
    expected: "(__type.o2 | undefined)",
    value: input.typing_started
  }), input.typing_stopped === undefined || (typeof input.typing_stopped === "object" && input.typing_stopped !== null || _report(_exceptionable, {
    path: _path + ".typing_stopped",
    expected: "(__type.o3 | undefined)",
    value: input.typing_stopped
  })) && _vo5(input.typing_stopped, _path + ".typing_stopped", _exceptionable) || _report(_exceptionable, {
    path: _path + ".typing_stopped",
    expected: "(__type.o3 | undefined)",
    value: input.typing_stopped
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [(typeof input.message === "object" && input.message !== null || _report(_exceptionable, {
    path: _path + ".message",
    expected: "Message",
    value: input.message
  })) && _vo2(input.message, _path + ".message", _exceptionable) || _report(_exceptionable, {
    path: _path + ".message",
    expected: "Message",
    value: input.message
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.channelId === "string" || _report(_exceptionable, {
    path: _path + ".channelId",
    expected: "string",
    value: input.channelId
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [typeof input.messageId === "string" || _report(_exceptionable, {
    path: _path + ".messageId",
    expected: "string",
    value: input.messageId
  })].every((flag) => flag);
  const _vo4 = (input, _path, _exceptionable = true) => [typeof input.userId === "string" || _report(_exceptionable, {
    path: _path + ".userId",
    expected: "string",
    value: input.userId
  }), typeof input.username === "string" || _report(_exceptionable, {
    path: _path + ".username",
    expected: "string",
    value: input.username
  })].every((flag) => flag);
  const _vo5 = (input, _path, _exceptionable = true) => [typeof input.userId === "string" || _report(_exceptionable, {
    path: _path + ".userId",
    expected: "string",
    value: input.userId
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && Array.isArray(input) === false && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null && Array.isArray(input2) === false || _report(true, {
        path: _path + "",
        expected: "Partial<ChatMessages.Events>",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "Partial<ChatMessages.Events>",
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
var validateChatMessagesCompletionData = (() => {
  const _io0 = (input) => input.reason === "disconnected" || input.reason === "channel_deleted";
  const _vo0 = (input, _path, _exceptionable = true) => [input.reason === "disconnected" || input.reason === "channel_deleted" || _report(_exceptionable, {
    path: _path + ".reason",
    expected: '("channel_deleted" | "disconnected")',
    value: input.reason
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
        expected: "ChatMessages.CompletionData",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ChatMessages.CompletionData",
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
var validateChatMessagesCompletionError = (() => {
  const _io0 = (input) => input.type === "ChannelNotFound";
  const _io1 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Unauthorized")
      return _io1(input);
    else if (input.type === "ChannelNotFound")
      return _io0(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "ChannelNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"ChannelNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Unauthorized")
      return _vo1(input, _path, _exceptionable);
    else if (input.type === "ChannelNotFound")
      return _vo0(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(__type.o1 | __type)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(__type | __type.o1)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(__type | __type.o1)",
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
var validateSessionContextData = (() => {
  const _io0 = (input) => typeof input.userId === "string" && typeof input.username === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.userId === "string" || _report(_exceptionable, {
    path: _path + ".userId",
    expected: "string",
    value: input.userId
  }), typeof input.username === "string" || _report(_exceptionable, {
    path: _path + ".username",
    expected: "string",
    value: input.username
  })].every((flag) => flag);
  const __is = (input) => input === null || typeof input === "object" && input !== null && _io0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => input2 === null || (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SessionData | null)",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SessionData | null)",
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
var validateSessionContextError = (() => {
  const _io0 = (input) => input.type === "SessionExpired";
  const _io1 = (input) => input.type === "SessionInvalid";
  const _iu0 = (input) => (() => {
    if (input.type === "SessionInvalid")
      return _io1(input);
    else if (input.type === "SessionExpired")
      return _io0(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "SessionExpired" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"SessionExpired"',
    value: input.type
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [input.type === "SessionInvalid" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"SessionInvalid"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "SessionInvalid")
      return _vo1(input, _path, _exceptionable);
    else if (input.type === "SessionExpired")
      return _vo0(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(__type.o1 | __type)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(__type | __type.o1)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(__type | __type.o1)",
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
var validateBlogPost = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.title === "string" && typeof input.slug === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.slug === "string" || _report(_exceptionable, {
    path: _path + ".slug",
    expected: "string",
    value: input.slug
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
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
        expected: "BlogPost",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "BlogPost",
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
var validateBlogPostsLoaderResponse = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.title === "string" && typeof input.slug === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.slug === "string" || _report(_exceptionable, {
    path: _path + ".slug",
    expected: "string",
    value: input.slug
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const __is = (input) => Array.isArray(input) && input.every((elem) => typeof elem === "object" && elem !== null && _io0(elem));
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (Array.isArray(input2) || _report(true, {
        path: _path + "",
        expected: "Array<BlogPost>",
        value: input2
      })) && input2.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(true, {
        path: _path + "[" + _index2 + "]",
        expected: "BlogPost",
        value: elem
      })) && _vo0(elem, _path + "[" + _index2 + "]", true) || _report(true, {
        path: _path + "[" + _index2 + "]",
        expected: "BlogPost",
        value: elem
      })).every((flag) => flag) || _report(true, {
        path: _path + "",
        expected: "Array<BlogPost>",
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
var validateBlogPostLoaderResponse = (() => {
  const _io0 = (input) => typeof input.id === "string" && typeof input.title === "string" && typeof input.slug === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.slug === "string" || _report(_exceptionable, {
    path: _path + ".slug",
    expected: "string",
    value: input.slug
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
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
        expected: "BlogPost",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "BlogPost",
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
var validateListBlogPostsPathParams = (() => {
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
        expected: "ListBlogPosts.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListBlogPosts.PathParams",
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
var validateListBlogPostsPathQuery = (() => {
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
        expected: "ListBlogPosts.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListBlogPosts.PathQuery",
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
var validateListBlogPostsBody = (() => {
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
        expected: "ListBlogPosts.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListBlogPosts.Body",
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
var validateListBlogPostsResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (Array.isArray(input.value) && input.value.every((elem) => typeof elem === "object" && elem !== null && _io1(elem))) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.title === "string" && typeof input.slug === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (Array.isArray(input.value) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<BlogPost>",
    value: input.value
  })) && input.value.map((elem, _index2) => (typeof elem === "object" && elem !== null || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "BlogPost",
    value: elem
  })) && _vo1(elem, _path + ".value[" + _index2 + "]", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value[" + _index2 + "]",
    expected: "BlogPost",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "Array<BlogPost>",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.slug === "string" || _report(_exceptionable, {
    path: _path + ".slug",
    expected: "string",
    value: input.slug
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
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
        expected: "ListBlogPosts.Response",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "ListBlogPosts.Response",
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
var validateGetBlogPostPathParams = (() => {
  const _io0 = (input) => typeof input.postId === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.postId === "string" || _report(_exceptionable, {
    path: _path + ".postId",
    expected: "string",
    value: input.postId
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
        expected: "GetBlogPost.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetBlogPost.PathParams",
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
var validateGetBlogPostPathQuery = (() => {
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
        expected: "GetBlogPost.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetBlogPost.PathQuery",
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
var validateGetBlogPostBody = (() => {
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
        expected: "GetBlogPost.Body",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "GetBlogPost.Body",
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
var validateGetBlogPostResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.title === "string" && typeof input.slug === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 404;
  const _io3 = (input) => input.type === "PostNotFound";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "BlogPost",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "BlogPost",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.slug === "string" || _report(_exceptionable, {
    path: _path + ".slug",
    expected: "string",
    value: input.slug
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 404 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "404",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "PostNotFound" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"PostNotFound"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<BlogPost, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_FOUND>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<BlogPost, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_FOUND> | SerializableResult.OkWithStatusCode<BlogPost, OK>)",
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
var validateCreateBlogPostPathParams = (() => {
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
        expected: "CreateBlogPost.PathParams",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateBlogPost.PathParams",
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
var validateCreateBlogPostPathQuery = (() => {
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
        expected: "CreateBlogPost.PathQuery",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateBlogPost.PathQuery",
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
var validateCreateBlogPostBody = (() => {
  const _io0 = (input) => typeof input.title === "string" && typeof input.content === "string";
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
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
        expected: "CreateBlogPostRequest",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CreateBlogPostRequest",
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
var validateCreateBlogPostResponse = (() => {
  const _io0 = (input) => input.type === "Ok" && (typeof input.value === "object" && input.value !== null && _io1(input.value)) && input.statusCode === 200;
  const _io1 = (input) => typeof input.id === "string" && typeof input.title === "string" && typeof input.slug === "string" && typeof input.content === "string" && typeof input.authorId === "string" && typeof input.authorUsername === "string" && typeof input.createdAt === "string" && typeof input.updatedAt === "string";
  const _io2 = (input) => input.type === "Err" && (typeof input.error === "object" && input.error !== null && _io3(input.error)) && input.statusCode === 401;
  const _io3 = (input) => input.type === "Unauthorized";
  const _iu0 = (input) => (() => {
    if (input.type === "Ok")
      return _io0(input);
    else if (input.type === "Err")
      return _io2(input);
    else
      return false;
  })();
  const _vo0 = (input, _path, _exceptionable = true) => [input.type === "Ok" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Ok"',
    value: input.type
  }), (typeof input.value === "object" && input.value !== null || _report(_exceptionable, {
    path: _path + ".value",
    expected: "BlogPost",
    value: input.value
  })) && _vo1(input.value, _path + ".value", _exceptionable) || _report(_exceptionable, {
    path: _path + ".value",
    expected: "BlogPost",
    value: input.value
  }), input.statusCode === 200 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "200",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo1 = (input, _path, _exceptionable = true) => [typeof input.id === "string" || _report(_exceptionable, {
    path: _path + ".id",
    expected: "string",
    value: input.id
  }), typeof input.title === "string" || _report(_exceptionable, {
    path: _path + ".title",
    expected: "string",
    value: input.title
  }), typeof input.slug === "string" || _report(_exceptionable, {
    path: _path + ".slug",
    expected: "string",
    value: input.slug
  }), typeof input.content === "string" || _report(_exceptionable, {
    path: _path + ".content",
    expected: "string",
    value: input.content
  }), typeof input.authorId === "string" || _report(_exceptionable, {
    path: _path + ".authorId",
    expected: "string",
    value: input.authorId
  }), typeof input.authorUsername === "string" || _report(_exceptionable, {
    path: _path + ".authorUsername",
    expected: "string",
    value: input.authorUsername
  }), typeof input.createdAt === "string" || _report(_exceptionable, {
    path: _path + ".createdAt",
    expected: "string",
    value: input.createdAt
  }), typeof input.updatedAt === "string" || _report(_exceptionable, {
    path: _path + ".updatedAt",
    expected: "string",
    value: input.updatedAt
  })].every((flag) => flag);
  const _vo2 = (input, _path, _exceptionable = true) => [input.type === "Err" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Err"',
    value: input.type
  }), (typeof input.error === "object" && input.error !== null || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  })) && _vo3(input.error, _path + ".error", _exceptionable) || _report(_exceptionable, {
    path: _path + ".error",
    expected: "__type",
    value: input.error
  }), input.statusCode === 401 || _report(_exceptionable, {
    path: _path + ".statusCode",
    expected: "401",
    value: input.statusCode
  })].every((flag) => flag);
  const _vo3 = (input, _path, _exceptionable = true) => [input.type === "Unauthorized" || _report(_exceptionable, {
    path: _path + ".type",
    expected: '"Unauthorized"',
    value: input.type
  })].every((flag) => flag);
  const _vu0 = (input, _path, _exceptionable = true) => (() => {
    if (input.type === "Ok")
      return _vo0(input, _path, _exceptionable);
    else if (input.type === "Err")
      return _vo2(input, _path, _exceptionable);
    else
      return _report(_exceptionable, {
        path: _path,
        expected: "(SerializableResult.OkWithStatusCode<BlogPost, OK> | SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED>)",
        value: input
      });
  })();
  const __is = (input) => typeof input === "object" && input !== null && _iu0(input);
  let errors;
  let _report;
  return __typia_transform__createStandardSchema._createStandardSchema((input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<BlogPost, OK>)",
        value: input2
      })) && _vu0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "(SerializableResult.ErrWithStatusCode<__type, NOT_AUTHENTICATED> | SerializableResult.OkWithStatusCode<BlogPost, OK>)",
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
  validateUser,
  validateUpdateTaskResponse,
  validateUpdateTaskPathQuery,
  validateUpdateTaskPathParams,
  validateUpdateTaskBody,
  validateUpdateCardResponse,
  validateUpdateCardPathQuery,
  validateUpdateCardPathParams,
  validateUpdateCardBody,
  validateTasksLoaderResponse,
  validateTaskPanelQueryTaskId,
  validateTask,
  validateSessionData,
  validateSessionContextError,
  validateSessionContextData,
  validateSendMessageResponse,
  validateSendMessagePathQuery,
  validateSendMessagePathParams,
  validateSendMessageBody,
  validateMoveCardResponse,
  validateMoveCardPathQuery,
  validateMoveCardPathParams,
  validateMoveCardBody,
  validateMessage,
  validateLogoutResponse,
  validateLogoutPathQuery,
  validateLogoutPathParams,
  validateLogoutBody,
  validateLoginResponse,
  validateLoginPathQuery,
  validateLoginPathParams,
  validateLoginBody,
  validateLoaderError,
  validateListTasksResponse,
  validateListTasksPathQuery,
  validateListTasksPathParams,
  validateListTasksBody,
  validateListChannelsResponse,
  validateListChannelsPathQuery,
  validateListChannelsPathParams,
  validateListChannelsBody,
  validateListBoardsResponse,
  validateListBoardsPathQuery,
  validateListBoardsPathParams,
  validateListBoardsBody,
  validateListBlogPostsResponse,
  validateListBlogPostsPathQuery,
  validateListBlogPostsPathParams,
  validateListBlogPostsBody,
  validateListAllTasksResponse,
  validateListAllTasksPathQuery,
  validateListAllTasksPathParams,
  validateListAllTasksBody,
  validateGetTaskResponse,
  validateGetTaskPathQuery,
  validateGetTaskPathParams,
  validateGetTaskBody,
  validateGetMessagesResponse,
  validateGetMessagesPathQuery,
  validateGetMessagesPathParams,
  validateGetMessagesBody,
  validateGetCurrentUserResponse,
  validateGetCurrentUserPathQuery,
  validateGetCurrentUserPathParams,
  validateGetCurrentUserBody,
  validateGetChannelResponse,
  validateGetChannelPathQuery,
  validateGetChannelPathParams,
  validateGetChannelBody,
  validateGetBoardResponse,
  validateGetBoardPathQuery,
  validateGetBoardPathParams,
  validateGetBoardBody,
  validateGetBlogPostResponse,
  validateGetBlogPostPathQuery,
  validateGetBlogPostPathParams,
  validateGetBlogPostBody,
  validateDeleteTaskResponse,
  validateDeleteTaskPathQuery,
  validateDeleteTaskPathParams,
  validateDeleteTaskBody,
  validateDeleteCardResponse,
  validateDeleteCardPathQuery,
  validateDeleteCardPathParams,
  validateDeleteCardBody,
  validateCreateTaskResponse,
  validateCreateTaskPathQuery,
  validateCreateTaskPathParams,
  validateCreateTaskBody,
  validateCreateListResponse,
  validateCreateListPathQuery,
  validateCreateListPathParams,
  validateCreateListBody,
  validateCreateChannelResponse,
  validateCreateChannelPathQuery,
  validateCreateChannelPathParams,
  validateCreateChannelBody,
  validateCreateCardResponse,
  validateCreateCardPathQuery,
  validateCreateCardPathParams,
  validateCreateCardBody,
  validateCreateBoardResponse,
  validateCreateBoardPathQuery,
  validateCreateBoardPathParams,
  validateCreateBoardBody,
  validateCreateBlogPostResponse,
  validateCreateBlogPostPathQuery,
  validateCreateBlogPostPathParams,
  validateCreateBlogPostBody,
  validateChatMessagesPathQuery,
  validateChatMessagesPathParams,
  validateChatMessagesEvents,
  validateChatMessagesCompletionError,
  validateChatMessagesCompletionData,
  validateChannelsLoaderResponse,
  validateChannelDetailLoaderResponse,
  validateChannel,
  validateCard,
  validateBoardsLoaderResponse,
  validateBoardUpdatesPathQuery,
  validateBoardUpdatesPathParams,
  validateBoardUpdatesEvents,
  validateBoardUpdatesCompletionError,
  validateBoardUpdatesCompletionData,
  validateBoardLoaderResponse,
  validateBoardList,
  validateBoard,
  validateBlogPostsLoaderResponse,
  validateBlogPostLoaderResponse,
  validateBlogPost,
  isUser,
  isTask,
  isSessionData,
  isMessage,
  isChannel,
  isCard,
  isBoard
};
