// src/lib/mathJaxFontConfig.ts
// MathJax v3 엔진 레벨 본문(Pretendard) 폰트 1:1 상속 + 분수(88%) 및 위/아래첨자(52%) 크기 보정 스크립트입니다.
// - 한국어 Windows Chrome의 최소 글꼴 크기(10px~12px) 제한 때문에 font-size 축소만으로는 14px 본문의 첨자가 줄지 않는 문제를
//   완전히 우회하기 위해, 첨자 내부는 scriptlevel="0"(100%)으로 유지한 채 CSS transform: scale(0.52) + MathML <mpadded width="0.52width">로
//   시각 크기와 레이아웃 폭을 동시에 52%로 정밀 축소합니다.
// - 인라인 분수(\frac)는 scriptlevel="0" + mathsize="88%"로 확실히 본문의 88% 크기가 되도록 지정합니다.

export const MATHJAX_FONT_INIT_SCRIPT = `
(function () {
  if (typeof window === 'undefined') return;
  var FILTER_VER = 6;

  var FIXED_ARITY = {
    mfrac: 1, msup: 1, msub: 1, msubsup: 1,
    munder: 1, mover: 1, munderover: 1,
    mroot: 1, mmultiscripts: 1
  };

  function getExplicitVariant(node) {
    if (!node || !node.attributes || typeof node.attributes.getExplicit !== 'function') return null;
    return node.attributes.getExplicit('mathvariant') || null;
  }

  function getExplicitAttr(node, name) {
    if (!node || !node.attributes || typeof node.attributes.getExplicit !== 'function') return undefined;
    return node.attributes.getExplicit(name);
  }

  function getExtraExplicitAttrs(node) {
    var out = {};
    var count = 0;
    if (node && node.attributes && typeof node.attributes.getExplicitNames === 'function') {
      var names = node.attributes.getExplicitNames();
      for (var i = 0; i < names.length; i++) {
        var k = names[i];
        if (k !== 'mathvariant') {
          out[k] = node.attributes.getExplicit(k);
          count++;
        }
      }
    }
    return { attrs: out, count: count };
  }

  function getNodeText(node) {
    if (!node) return '';
    if (typeof node.getText === 'function') return node.getText();
    if (!node.childNodes) return '';
    var s = '';
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c && typeof c.getText === 'function') s += c.getText();
    }
    return s;
  }

  function hasAlphaNumNode(node) {
    if (!node) return false;
    if (node.isKind && (node.isKind('mtext') || node.isKind('mn') || node.isKind('mi'))) {
      var txt = getNodeText(node);
      if (/[0-9A-Za-z]/.test(txt)) return true;
    }
    if (node.childNodes && node.childNodes.length) {
      for (var i = 0; i < node.childNodes.length; i++) {
        if (hasAlphaNumNode(node.childNodes[i])) return true;
      }
    }
    return false;
  }

  function makePlainMtext(factory, text, isBold, sourceNode) {
    var extra = getExtraExplicitAttrs(sourceNode);
    var attrs = extra.attrs;
    if (isBold) {
      attrs['class'] = (attrs['class'] ? attrs['class'] + ' ' : '') + 'logica-mjx-bold';
      attrs['style'] = (attrs['style'] ? attrs['style'] + ';' : '') + 'font-weight:700;';
    }
    var tNode = factory.create('text').setText(text);
    var mtext = factory.create('mtext', attrs, [tNode]);
    mtext.__logicaPlain = isBold ? 'bold' : 'normal';
    mtext.__logicaHasExtraAttrs = extra.count > 0;
    if (sourceNode && typeof sourceNode.texClass === 'number') {
      mtext.texClass = sourceNode.texClass;
    }
    return mtext;
  }

  function makeCurvedItalicNode(factory, text, sourceNode) {
    var extra = getExtraExplicitAttrs(sourceNode);
    var parts = text.match(/[A-Za-z]+|[^A-Za-z]+/g) || [text];
    if (parts.length === 1 && /^[A-Za-z]+$/.test(parts[0])) {
      var attrs = extra.attrs;
      attrs.mathvariant = 'italic';
      var mi = factory.create('mi', attrs, [factory.create('text').setText(parts[0])]);
      mi.__logicaKeepCurved = true;
      return mi;
    }
    var children = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (/^[A-Za-z]+$/.test(seg)) {
        var miSeg = factory.create('mi', { mathvariant: 'italic' }, [factory.create('text').setText(seg)]);
        miSeg.__logicaKeepCurved = true;
        children.push(miSeg);
      } else {
        children.push(makePlainMtext(factory, seg, false, null));
      }
    }
    return factory.create('mrow', extra.attrs, children);
  }

  function wrapInlineFracSize(factory, node) {
    if (!node || node.__logicaSizeWrapped) return node;
    var wrapped = factory.create('mstyle', { scriptlevel: '0', mathsize: '88%', scriptminsize: '0px' }, [node]);
    wrapped.__logicaSizeWrapped = true;
    return wrapped;
  }

  function wrapScaledScript(factory, node, isNested) {
    if (!node || node.__logicaSizeWrapped) return node;
    var cls = isNested ? 'logica-mjx-script-sm' : 'logica-mjx-script';
    var ratio = isNested ? '0.56' : '0.72';
    var styled = factory.create('mstyle', { scriptlevel: '0', 'class': cls }, [node]);
    styled.__logicaSizeWrapped = true;
    var padded = factory.create('mpadded', {
      width: ratio + 'width',
      height: ratio + 'height',
      depth: ratio + 'depth'
    }, [styled]);
    padded.__logicaSizeWrapped = true;
    return padded;
  }

  function transformChild(node, factory, inheritedVariant, inDisplay, scriptDepth) {
    if (!node || typeof node.isKind !== 'function') return node;
    var ownVariant = getExplicitVariant(node);
    var effVariant = ownVariant || inheritedVariant || null;

    var explicitDisp = getExplicitAttr(node, 'displaystyle');
    var nextDisplay = inDisplay;
    if (explicitDisp === true || explicitDisp === 'true') nextDisplay = true;
    else if (explicitDisp === false || explicitDisp === 'false') nextDisplay = false;

    if (node.isKind('mtext')) {
      if (ownVariant === 'italic' || ownVariant === '-tex-mathit') {
        var itTxt = getNodeText(node);
        if (itTxt && /[A-Za-z]/.test(itTxt)) {
          return makeCurvedItalicNode(factory, itTxt, node);
        }
      }
      return node;
    }

    if (node.isKind('mn')) {
      var mnTxt = getNodeText(node);
      if (mnTxt && /^[0-9.,]+$/.test(mnTxt) && (!effVariant || effVariant === 'normal' || effVariant === 'bold')) {
        return makePlainMtext(factory, mnTxt, effVariant === 'bold', node);
      }
      return node;
    }

    if (node.isKind('mi') && !node.__logicaKeepCurved) {
      var miTxt = getNodeText(node);
      if (miTxt && /^[A-Za-z]+$/.test(miTxt) && (!effVariant || effVariant === 'normal' || effVariant === 'bold')) {
        return makePlainMtext(factory, miTxt, effVariant === 'bold', node);
      }
      return node;
    }

    transformTree(node, factory, effVariant, nextDisplay, scriptDepth);
    return node;
  }

  function canMergePlain(a, b) {
    if (!a || !b) return false;
    if (!a.__logicaPlain || a.__logicaPlain !== b.__logicaPlain) return false;
    if (a.__logicaHasExtraAttrs || b.__logicaHasExtraAttrs) return false;
    var tcA = typeof a.texClass === 'number' ? a.texClass : 0;
    var tcB = typeof b.texClass === 'number' ? b.texClass : 0;
    return tcA === 0 && tcB === 0;
  }

  function transformTree(parent, factory, inheritedVariant, inDisplay, scriptDepth) {
    if (!parent || !parent.childNodes || parent.childNodes.length === 0) return;
    if (parent.isKind && (parent.isKind('mtext') || parent.isKind('mn') || parent.isKind('mi') || parent.isKind('mo') || parent.isKind('ms') || parent.isKind('text'))) {
      return;
    }

    if (parent.isKind && parent.isKind('math') && parent.attributes && typeof parent.attributes.set === 'function') {
      parent.attributes.set('scriptminsize', '0px');
    }

    var ownVariant = getExplicitVariant(parent);
    var nextVariant = ownVariant || inheritedVariant || null;

    var explicitDisp = getExplicitAttr(parent, 'displaystyle');
    var currDisplay = inDisplay;
    if (explicitDisp === true || explicitDisp === 'true') currDisplay = true;
    else if (explicitDisp === false || explicitDisp === 'false') currDisplay = false;

    var kind = parent.kind || '';
    var origChildren = parent.childNodes;
    var transformed = [];
    var changed = false;

    var isInlineFrac = kind === 'mfrac' && !currDisplay && scriptDepth === 0;
    var isSupSub = kind === 'msup' || kind === 'msub' || kind === 'msubsup';

    for (var i = 0; i < origChildren.length; i++) {
      var orig = origChildren[i];
      var childInDisplay = kind === 'mfrac' ? false : currDisplay;
      var childScriptDepth = (isSupSub && i > 0) ? (scriptDepth + 1) : scriptDepth;
      var next = transformChild(orig, factory, nextVariant, childInDisplay, childScriptDepth);

      // 1) 인라인 분수(\\frac): scriptlevel=0 + mathsize=88%로 본문의 정확히 88% 크기
      if (isInlineFrac && (i === 0 || i === 1) && next && !next.__logicaSizeWrapped) {
        next = wrapInlineFracSize(factory, next);
      }

      // 2) 위첨자·아래첨자(22cm^2, 22m^3, 3^{50}, a_n):
      //    크롬 최소 폰트 크기(10~12px) 제한을 우회하기 위해 transform: scale(0.52) + mpadded(0.52width) 적용
      //    (단, 90^\\circ 각도 기호나 f'(x) 프라임처럼 숫자/영문이 없는 순수 기호 첨자는 원형 유지)
      if (isSupSub && i > 0 && next && !next.__logicaSizeWrapped && (!next.isKind || !next.isKind('mfrac')) && hasAlphaNumNode(next)) {
        next = wrapScaledScript(factory, next, childScriptDepth >= 2);
      }

      if (next !== orig) changed = true;
      transformed.push(next);
    }

    if (!FIXED_ARITY[kind] && transformed.length > 1) {
      var merged = [transformed[0]];
      for (var j = 1; j < transformed.length; j++) {
        var prev = merged[merged.length - 1];
        var curr = transformed[j];
        if (canMergePlain(prev, curr)) {
          var combinedText = getNodeText(prev) + getNodeText(curr);
          merged[merged.length - 1] = makePlainMtext(factory, combinedText, prev.__logicaPlain === 'bold', null);
          changed = true;
        } else {
          merged.push(curr);
        }
      }
      transformed = merged;
    }

    if (changed && typeof parent.setChildren === 'function') {
      parent.setChildren(transformed);
    }
  }

  function patchOutputJaxMeasure(outJax) {
    if (!outJax || typeof outJax.measureText !== 'function') return false;
    var patchedNow = false;
    if (!outJax.__logicaOrigMeasureText) {
      outJax.__logicaOrigMeasureText = outJax.measureText;
    }
    if (outJax.__logicaMeasureVer !== FILTER_VER) {
      outJax.__logicaMeasureVer = FILTER_VER;
      patchedNow = true;
      if (outJax.unknownCache && typeof outJax.unknownCache.clear === 'function') {
        outJax.unknownCache.clear();
      }
      var origFn = outJax.__logicaOrigMeasureText;
      outJax.measureText = function (text, variant, font) {
        var res = origFn.apply(this, arguments);
        if (res && typeof res === 'object' && typeof res.w === 'number') {
          var str = String(text || '');
          var pEm = (this.math && this.math.metrics && this.math.metrics.scale)
            ? (1 / this.math.metrics.scale)
            : ((res.h + res.d) * 0.83);
          var hasDescender = /[gjpqy(),;|]/.test(str);
          var isPureXHeight = /[aceimnorsuvwxz]/.test(str) && /^[aceimnorsuvwxz.:\\u0020\\u00A0-]+$/.test(str);
          return {
            w: res.w,
            h: isPureXHeight ? (0.52 * pEm) : (0.72 * pEm),
            d: hasDescender ? (0.19 * pEm) : (0.01 * pEm)
          };
        }
        return res;
      };
    }
    return patchedNow;
  }

  var verChanged = window.__logicaMathJaxFilterVer !== FILTER_VER;
  window.__logicaMathJaxFilterVer = FILTER_VER;
  window.__logicaTransformMml = function (root, factory, isDisplay) {
    transformTree(root, factory, null, !!isDisplay, 0);
  };

  function installOnMathJaxInstance(MJ, retypeset) {
    if (!MJ || !MJ.startup) return false;
    var installedNow = false;
    try {
      var outJax = MJ.startup.output;
      if (outJax) {
        if (outJax.options) {
          outJax.options.mtextInheritFont = true;
          outJax.options.merrorInheritFont = true;
        }
        if (patchOutputJaxMeasure(outJax)) installedNow = true;
      }
      var doc = MJ.startup.document;
      if (doc && doc.outputJax) {
        if (doc.outputJax.options) {
          doc.outputJax.options.mtextInheritFont = true;
          doc.outputJax.options.merrorInheritFont = true;
        }
        if (patchOutputJaxMeasure(doc.outputJax)) installedNow = true;
      }
      var inputs = MJ.startup.input || [];
      for (var i = 0; i < inputs.length; i++) {
        var jax = inputs[i];
        if (jax && jax.name === 'TeX' && jax.postFilters && !jax.__logicaFontFilterInstalled) {
          jax.__logicaFontFilterInstalled = true;
          installedNow = true;
          jax.postFilters.add(function (arg) {
            try {
              var root = arg && arg.data && (arg.data.root || arg.data);
              var factory = (arg && arg.data && arg.data.nodeFactory && arg.data.nodeFactory.mmlFactory) || (root && root.factory);
              var isDisp = Boolean(arg && arg.math && arg.math.display);
              if (!root || !factory || typeof window.__logicaTransformMml !== 'function') return;
              window.__logicaTransformMml(root, factory, isDisp);
            } catch (err) {
              console.warn('[LogicaMath] postFilter skipped:', err);
            }
          });
        }
      }
      if (retypeset && (installedNow || verChanged) && typeof MJ.typesetPromise === 'function') {
        verChanged = false;
        if (typeof MJ.typesetClear === 'function') MJ.typesetClear();
        MJ.typesetPromise().catch(function () {});
      }
    } catch (e) {
      console.warn('[LogicaMath] install error:', e);
    }
    return installedNow;
  }

  function enhanceConfig(cfg) {
    if (!cfg || typeof cfg !== 'object' || cfg.version || cfg.__logicaConfigEnhanced) return cfg;
    cfg.__logicaConfigEnhanced = true;
    cfg.chtml = Object.assign({ mtextInheritFont: true, merrorInheritFont: true }, cfg.chtml || {});
    var prevStartup = cfg.startup || {};
    var prevReady = prevStartup.ready;
    cfg.startup = Object.assign({}, prevStartup, {
      ready: function () {
        if (typeof prevReady === 'function') {
          prevReady();
        } else if (window.MathJax && window.MathJax.startup && typeof window.MathJax.startup.defaultReady === 'function') {
          window.MathJax.startup.defaultReady();
        }
        installOnMathJaxInstance(window.MathJax, false);
      }
    });
    return cfg;
  }

  window.__applyLogicaMathJaxFont = function (retypeset) {
    if (window.MathJax && window.MathJax.version) {
      installOnMathJaxInstance(window.MathJax, !!retypeset);
    } else if (window.MathJax) {
      enhanceConfig(window.MathJax);
    }
  };

  if (window.__logicaMathJaxHookInstalled) {
    window.__applyLogicaMathJaxFont(true);
    return;
  }
  window.__logicaMathJaxHookInstalled = true;

  var _mjx = window.MathJax ? enhanceConfig(window.MathJax) : undefined;
  if (_mjx && _mjx.version) {
    installOnMathJaxInstance(_mjx, true);
  }

  try {
    Object.defineProperty(window, 'MathJax', {
      configurable: true,
      enumerable: true,
      get: function () {
        return _mjx;
      },
      set: function (val) {
        if (_mjx && _mjx.version && val && !val.version) {
          installOnMathJaxInstance(_mjx, false);
          return;
        }
        _mjx = enhanceConfig(val);
        if (_mjx && _mjx.version) {
          installOnMathJaxInstance(_mjx, false);
        }
      }
    });
  } catch (e) {}
})();
`;
