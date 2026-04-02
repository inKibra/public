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

// lib/cdn-worker-secrets.schemas.ts
var __typia_transform__validateReport = __toESM(require__validateReport(), 1);
var validateCdnConfig = (input) => (() => {
  const _io0 = (input2) => typeof input2.signingIssuer === "string" && typeof input2.signingSecret === "string";
  const _vo0 = (input2, _path, _exceptionable = true) => [typeof input2.signingIssuer === "string" || _report(_exceptionable, {
    path: _path + ".signingIssuer",
    expected: "string",
    value: input2.signingIssuer
  }), typeof input2.signingSecret === "string" || _report(_exceptionable, {
    path: _path + ".signingSecret",
    expected: "string",
    value: input2.signingSecret
  })].every((flag) => flag);
  const __is = (input2) => typeof input2 === "object" && input2 !== null && _io0(input2);
  let errors;
  let _report;
  return (input2) => {
    if (__is(input2) === false) {
      errors = [];
      _report = __typia_transform__validateReport._validateReport(errors);
      ((input3, _path, _exceptionable = true) => (typeof input3 === "object" && input3 !== null || _report(true, {
        path: _path + "",
        expected: "CdnConfig",
        value: input3
      })) && _vo0(input3, _path + "", true) || _report(true, {
        path: _path + "",
        expected: "CdnConfig",
        value: input3
      }))(input2, "$input", true);
      const success = errors.length === 0;
      return success ? {
        success,
        data: input2
      } : {
        success,
        errors,
        data: input2
      };
    }
    return {
      success: true,
      data: input2
    };
  };
})()(input);
export {
  validateCdnConfig
};
