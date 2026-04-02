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

// ../../../node_modules/.bun/typia@9.7.2+dd9c7f700dbbebd3/node_modules/typia/lib/internal/_isFormatHostname.js
var require__isFormatHostname = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports._isFormatHostname = undefined;
  var _isFormatHostname = (str) => PATTERN.test(str);
  exports._isFormatHostname = _isFormatHostname;
  var PATTERN = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i;
});

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

// lib/cdn-worker-config.schemas.ts
var __typia_transform__isFormatHostname = __toESM(require__isFormatHostname(), 1);
var __typia_transform__validateReport = __toESM(require__validateReport(), 1);
var validateParseCdnWorkerConfig = (() => {
  const _io0 = (input) => typeof input.cdnDomain === "string" && __typia_transform__isFormatHostname._isFormatHostname(input.cdnDomain) && (typeof input.zoneName === "string" && __typia_transform__isFormatHostname._isFormatHostname(input.zoneName)) && (Array.isArray(input.buckets) && input.buckets.every((elem) => typeof elem === "string" && 1 <= elem.length));
  const _vo0 = (input, _path, _exceptionable = true) => [typeof input.cdnDomain === "string" && (__typia_transform__isFormatHostname._isFormatHostname(input.cdnDomain) || _report(_exceptionable, {
    path: _path + ".cdnDomain",
    expected: 'string & Format<"hostname">',
    value: input.cdnDomain
  })) || _report(_exceptionable, {
    path: _path + ".cdnDomain",
    expected: '(string & Format<"hostname">)',
    value: input.cdnDomain
  }), typeof input.zoneName === "string" && (__typia_transform__isFormatHostname._isFormatHostname(input.zoneName) || _report(_exceptionable, {
    path: _path + ".zoneName",
    expected: 'string & Format<"hostname">',
    value: input.zoneName
  })) || _report(_exceptionable, {
    path: _path + ".zoneName",
    expected: '(string & Format<"hostname">)',
    value: input.zoneName
  }), (Array.isArray(input.buckets) || _report(_exceptionable, {
    path: _path + ".buckets",
    expected: "Array<string & MinLength<1>>",
    value: input.buckets
  })) && input.buckets.map((elem, _index2) => typeof elem === "string" && (1 <= elem.length || _report(_exceptionable, {
    path: _path + ".buckets[" + _index2 + "]",
    expected: "string & MinLength<1>",
    value: elem
  })) || _report(_exceptionable, {
    path: _path + ".buckets[" + _index2 + "]",
    expected: "(string & MinLength<1>)",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".buckets",
    expected: "Array<string & MinLength<1>>",
    value: input.buckets
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && _io0(input);
  let errors;
  let _report;
  const __validate = (input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "CdnWorkerConfig",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CdnWorkerConfig",
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
  };
  return (input) => __validate(JSON.parse(input));
})();
var validateParseCdnWorkerDeploymentRecord = (() => {
  const _io0 = (input) => Array.isArray(input.workers) && input.workers.every((elem) => typeof elem === "string" && 1 <= elem.length);
  const _vo0 = (input, _path, _exceptionable = true) => [(Array.isArray(input.workers) || _report(_exceptionable, {
    path: _path + ".workers",
    expected: "Array<string & MinLength<1>>",
    value: input.workers
  })) && input.workers.map((elem, _index2) => typeof elem === "string" && (1 <= elem.length || _report(_exceptionable, {
    path: _path + ".workers[" + _index2 + "]",
    expected: "string & MinLength<1>",
    value: elem
  })) || _report(_exceptionable, {
    path: _path + ".workers[" + _index2 + "]",
    expected: "(string & MinLength<1>)",
    value: elem
  })).every((flag) => flag) || _report(_exceptionable, {
    path: _path + ".workers",
    expected: "Array<string & MinLength<1>>",
    value: input.workers
  })].every((flag) => flag);
  const __is = (input) => typeof input === "object" && input !== null && _io0(input);
  let errors;
  let _report;
  const __validate = (input) => {
    if (__is(input) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input2, _path, _exceptionable = true) => (typeof input2 === "object" && input2 !== null || _report(true, {
        path: _path + "",
        expected: "CdnWorkerDeploymentRecord",
        value: input2
      })) && _vo0(input2, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CdnWorkerDeploymentRecord",
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
  };
  return (input) => __validate(JSON.parse(input));
})();
export {
  validateParseCdnWorkerDeploymentRecord,
  validateParseCdnWorkerConfig
};
