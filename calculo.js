/* Motor de cálculo da rescisão (CLT) — tabelas de 2026.
   Funciona no navegador (window.Rescisao) e no Node (module.exports), para poder testar. */
(function (root) {
  "use strict";

  // ---------- Tabelas oficiais 2026 ----------
  var TAB = {
    ano: 2026,
    salMin: 1621.0,
    tetoINSS: 8475.55,
    // [limite da faixa, alíquota] — INSS progressivo (cada alíquota só vale para a parte dentro da faixa)
    inss: [[1621.0, 0.075], [2902.84, 0.09], [4354.27, 0.12], [8475.55, 0.14]],
    // [limite, alíquota, parcela a deduzir] — tabela mensal do IRRF
    ir: [[2428.80, 0, 0], [2826.65, 0.075, 182.16], [3751.05, 0.15, 394.16], [4664.68, 0.225, 675.49], [Infinity, 0.275, 908.73]],
    simplificado: 607.20,        // desconto simplificado mensal (25% de 2.428,80)
    dependente: 189.59,          // dedução por dependente
    isencaoTotal: 5000.00,       // Lei 15.270/2025: até aqui o IR zera
    limiteRedutor: 7350.00,      // acima daqui não há redução
    redA: 978.62, redB: 0.133145 // redutor = 978,62 − 0,133145 × renda (entre 5.000,01 e 7.350)
  };

  var DAY = 864e5;
  function r2(x) { return Math.round((x + 1e-9) * 100) / 100; }
  function P(s) { var a = s.split("-").map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); }
  function ymd(t) { var d = new Date(t); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
  function addMonths(t, n) {
    var o = ymd(t), dim = new Date(Date.UTC(o.y, o.m + n, 0)).getUTCDate();
    var nd = new Date(Date.UTC(o.y, o.m - 1 + n, 1));
    return Date.UTC(nd.getUTCFullYear(), nd.getUTCMonth(), Math.min(o.d, dim));
  }
  // anos completos de casa (conta o dia da admissão: completa 1 ano no dia anterior ao aniversário)
  function anosCompletos(a, b) { var n = 0; while (addMonths(a, 12 * (n + 1)) <= b + DAY) n++; return n; }

  function inss(base) {
    base = Math.min(Math.max(base, 0), TAB.tetoINSS);
    var prev = 0, t = 0;
    for (var i = 0; i < TAB.inss.length; i++) {
      var lim = TAB.inss[i][0], al = TAB.inss[i][1];
      if (base > prev) { t += (Math.min(base, lim) - prev) * al; prev = lim; }
    }
    return r2(t);
  }

  function impostoTabela(base) {
    if (base <= 0) return 0;
    for (var i = 0; i < TAB.ir.length; i++) {
      if (base <= TAB.ir[i][0]) return Math.max(0, base * TAB.ir[i][1] - TAB.ir[i][2]);
    }
    return 0;
  }

  // IRRF sobre uma renda tributável (mensal ou 13º): escolhe a dedução mais vantajosa e aplica o redutor 2026
  function irrf(renda, inssV, deps) {
    var out = { imposto: 0, modelo: "—", tabela: 0, reducao: 0 };
    if (renda <= 0) return out;
    var t1 = impostoTabela(renda - inssV - deps * TAB.dependente);
    var t2 = impostoTabela(renda - TAB.simplificado);
    var imp = Math.min(t1, t2);
    out.modelo = t2 < t1 ? "simplificado" : "legal";
    out.tabela = r2(imp);
    var red = 0;
    if (renda <= TAB.isencaoTotal) red = imp;
    else if (renda <= TAB.limiteRedutor) red = Math.max(0, TAB.redA - TAB.redB * renda);
    red = Math.min(red, imp);
    out.reducao = r2(red);
    out.imposto = r2(Math.max(0, imp - red));
    return out;
  }

  var TIPOS = {
    sem_justa:             { nome: "Demitido sem justa causa", aviso: ["indenizado", "trabalhado"], multa: 0.40, saque: 1.0, seguro: true,  decimo: true,  ferias: true },
    pedido:                { nome: "Pedido de demissão", aviso: ["trabalhado", "nao_cumprido", "dispensado"], multa: 0, saque: 0, seguro: false, decimo: true, ferias: true },
    acordo:                { nome: "Acordo entre as partes (art. 484-A)", aviso: ["indenizado", "trabalhado"], multa: 0.20, saque: 0.8, seguro: false, decimo: true, ferias: true },
    indireta:              { nome: "Rescisão indireta (falta grave da empresa)", aviso: ["indenizado", "trabalhado"], multa: 0.40, saque: 1.0, seguro: true, decimo: true, ferias: true },
    termino:               { nome: "Fim do contrato por prazo (experiência / determinado)", aviso: [], multa: 0, saque: 1.0, seguro: false, decimo: true, ferias: true },
    antecipado_empregador: { nome: "Empresa encerrou contrato por prazo antes do fim", aviso: [], multa: 0.40, saque: 1.0, seguro: false, decimo: true, ferias: true },
    antecipado_empregado:  { nome: "Eu encerrei contrato por prazo antes do fim", aviso: [], multa: 0, saque: 0, seguro: false, decimo: true, ferias: true },
    justa:                 { nome: "Demitido por justa causa", aviso: [], multa: 0, saque: 0, seguro: false, decimo: false, ferias: false }
  };

  /* entrada: { admissao:'YYYY-MM-DD', saida:'YYYY-MM-DD', fimContrato:'YYYY-MM-DD'|'', remuneracao:number,
               tipo, aviso, feriasVencidas:int, feriasDobro:int, dependentes:int, saldoFGTS:number|null,
               adiantamento13:number, outrosProventos:number, outrosDescontos:number } */
  function calcular(inp) {
    var T = TIPOS[inp.tipo];
    var adm = P(inp.admissao), dem = P(inp.saida);
    var rem = +inp.remuneracao || 0;
    var deps = Math.max(0, parseInt(inp.dependentes, 10) || 0);
    var aviso = T.aviso.indexOf(inp.aviso) >= 0 ? inp.aviso : (T.aviso[0] || "nenhum");
    var prov = [], desc = [], obs = [], det = {};

    var anos = anosCompletos(adm, dem);
    var diasAviso = Math.min(30 + 3 * anos, 90);
    var induzida = (inp.tipo === "sem_justa" || inp.tipo === "indireta" || inp.tipo === "acordo");
    var projeta = induzida && aviso === "indenizado";
    var proj = projeta ? dem + diasAviso * DAY : dem;
    det.anos = anos; det.diasAviso = diasAviso; det.dataFinal = proj;

    // 1) Saldo de salário
    var dd = ymd(dem), ult = new Date(Date.UTC(dd.y, dd.m, 0)).getUTCDate();
    var dias = dd.d === ult ? 30 : dd.d;
    var aa = ymd(adm);
    if (aa.y === dd.y && aa.m === dd.m) dias = dias - aa.d + 1;
    dias = Math.max(0, Math.min(30, dias));
    var saldo = r2(rem / 30 * dias);
    prov.push({ nome: "Saldo de salário", info: dias + " dia(s) do último mês", valor: saldo, tipo: "tribut" });
    det.diasSaldo = dias;

    // 2) Aviso prévio
    var avisoVal = 0;
    if (aviso === "indenizado") {
      var f = inp.tipo === "acordo" ? 0.5 : 1;
      avisoVal = r2(rem / 30 * diasAviso * f);
      prov.push({ nome: "Aviso prévio indenizado", info: diasAviso + " dias" + (f < 1 ? " (50% — acordo)" : "") + " · sem INSS e sem IR", valor: avisoVal, tipo: "isento" });
    } else if (aviso === "trabalhado") {
      obs.push("Aviso trabalhado: você recebe o salário normal dos dias trabalhados; não há valor extra de aviso.");
    } else if (aviso === "nao_cumprido") {
      desc.push({ nome: "Aviso prévio não cumprido", info: "30 dias descontados", valor: r2(rem) });
    } else if (aviso === "dispensado") {
      obs.push("Aviso dispensado pela empresa: sem pagamento e sem desconto.");
    }

    // 3) 13º proporcional
    var avos13 = 0, v13 = 0;
    if (T.decimo) {
      var Y = ymd(proj).y;
      for (var mth = 1; mth <= 12; mth++) {
        var ms = Math.max(Date.UTC(Y, mth - 1, 1), adm);
        var me = Math.min(Date.UTC(Y, mth, 0), proj);
        if (me >= ms && (me - ms) / DAY + 1 >= 15) avos13++;
      }
      v13 = r2(rem / 12 * avos13);
      prov.push({ nome: "13º salário proporcional", info: avos13 + "/12 avos" + (projeta ? " (inclui o aviso indenizado)" : ""), valor: v13, tipo: "dec" });
    }
    det.avos13 = avos13;

    // 4) Férias vencidas
    var venc = Math.max(0, parseInt(inp.feriasVencidas, 10) || 0);
    var dobro = Math.min(venc, Math.max(0, parseInt(inp.feriasDobro, 10) || 0));
    if (venc > 0) {
      var vv = r2(venc * rem * 4 / 3);
      prov.push({ nome: "Férias vencidas + 1/3", info: venc + " período(s) · sem INSS e sem IR", valor: vv, tipo: "isento" });
      if (dobro > 0) prov.push({ nome: "Dobra das férias vencidas", info: dobro + " período(s) pagos em dobro (art. 137 CLT)", valor: r2(dobro * rem * 4 / 3), tipo: "isento" });
    }

    // 5) Férias proporcionais
    var avosF = 0;
    if (T.ferias) {
      var k = anosCompletos(adm, proj);
      var ini = addMonths(adm, 12 * k), fimEx = proj + DAY, m = 0;
      while (addMonths(ini, m + 1) <= fimEx) m++;
      if ((fimEx - addMonths(ini, m)) / DAY >= 15) m++;
      avosF = Math.min(m, 12);
      if (avosF > 0) {
        var fp = r2(rem / 12 * avosF);
        prov.push({ nome: "Férias proporcionais", info: avosF + "/12 avos" + (projeta ? " (inclui o aviso)" : "") + " · sem INSS e sem IR", valor: fp, tipo: "isento" });
        prov.push({ nome: "1/3 constitucional das férias proporcionais", info: "sem INSS e sem IR", valor: r2(fp / 3), tipo: "isento" });
      }
    }
    det.avosF = avosF;

    // 6) Contrato por prazo encerrado antes do fim (arts. 479 e 480)
    if ((inp.tipo === "antecipado_empregador" || inp.tipo === "antecipado_empregado") && inp.fimContrato) {
      var restantes = Math.max(0, Math.round((P(inp.fimContrato) - dem) / DAY));
      var ind = r2(0.5 * rem / 30 * restantes);
      det.diasRestantes = restantes;
      if (inp.tipo === "antecipado_empregador")
        prov.push({ nome: "Indenização do art. 479 (metade do que faltava)", info: restantes + " dia(s) restantes · sem INSS e sem IR", valor: ind, tipo: "isento" });
      else
        desc.push({ nome: "Indenização à empresa (art. 480)", info: "limite: metade do que faltava (" + restantes + " dia(s)); só vale se a empresa provar prejuízo", valor: ind });
    }

    if (inp.outrosProventos > 0) prov.push({ nome: "Outros valores a receber", info: "informado por você, sem imposto", valor: r2(inp.outrosProventos), tipo: "isento" });

    // 7) Impostos
    var inssMes = inss(saldo);
    var irMes = irrf(saldo, inssMes, deps);
    var inss13 = inss(v13);
    var ir13 = irrf(v13, inss13, deps);
    det.irMes = irMes; det.ir13 = ir13;
    if (inssMes > 0) desc.push({ nome: "INSS sobre o saldo de salário", info: "tabela progressiva 2026", valor: inssMes, imposto: true });
    if (irMes.imposto > 0) desc.push({ nome: "IRRF sobre o saldo de salário", info: "dedução " + irMes.modelo + (irMes.reducao > 0 ? " · com redução da Lei 15.270" : ""), valor: irMes.imposto, imposto: true });
    if (inss13 > 0) desc.push({ nome: "INSS sobre o 13º", info: "calculado à parte, com teto próprio", valor: inss13, imposto: true });
    if (ir13.imposto > 0) desc.push({ nome: "IRRF sobre o 13º", info: "tributação exclusiva na fonte" + (ir13.reducao > 0 ? " · com redução da Lei 15.270" : ""), valor: ir13.imposto, imposto: true });
    if (inp.adiantamento13 > 0) desc.push({ nome: "Adiantamento do 13º já recebido", info: "1ª parcela paga durante o ano", valor: r2(inp.adiantamento13) });
    if (inp.outrosDescontos > 0) desc.push({ nome: "Outros descontos", info: "adiantamentos, vale-transporte, consignado etc.", valor: r2(inp.outrosDescontos) });

    // 8) FGTS
    var meses = Math.max(0, Math.round((dem - adm) / DAY / 30.4375));
    var estimado = !(inp.saldoFGTS > 0);
    var saldoFGTS = estimado ? r2(0.08 * rem * meses) : r2(inp.saldoFGTS);
    var depRes = r2(0.08 * (saldo + v13 + avisoVal));
    var baseMulta = r2(saldoFGTS + depRes);
    var multa = r2(baseMulta * T.multa);
    var aniv = !!inp.saqueAniversario;
    var saque = aniv ? 0 : r2(baseMulta * T.saque);

    function soma(a, f) { return r2(a.reduce(function (s, x) { return s + (f ? f(x) : x.valor); }, 0)); }
    var totProv = soma(prov), totDesc = soma(desc);
    var impostos = soma(desc.filter(function (d) { return d.imposto; }));
    var liquido = r2(totProv - totDesc);
    var fgtsTotal = r2(saque + multa);

    if (!T.seguro) { /* sem aviso */ } else obs.push("Você tem direito ao seguro-desemprego (se cumprir os prazos de carência): peça no app Carteira de Trabalho Digital ou gov.br em até 120 dias.");
    if (aniv && T.saque > 0) obs.push("Saque-aniversário: você NÃO saca o saldo do FGTS na demissão (ele fica na conta e só sai no mês do seu aniversário), mas recebe a multa normalmente.");
    else if (T.saque === 0) obs.push("Neste tipo de saída o saldo do FGTS NÃO pode ser sacado agora; ele continua na conta.");
    if (inp.tipo === "acordo") obs.push("No acordo você saca 80% do FGTS, recebe 20% de multa e metade do aviso. Não tem seguro-desemprego.");
    obs.push("A empresa tem até 10 dias corridos após o último dia para pagar as verbas rescisórias.");

    return {
      tipo: inp.tipo, nomeTipo: T.nome, aviso: aviso, det: det,
      proventos: prov, descontos: desc, obs: obs,
      totalProventos: totProv, totalDescontos: totDesc, impostos: impostos, liquido: liquido,
      fgts: { aniversario: aniv, saldo: saldoFGTS, estimado: estimado, depositoRescisao: depRes, base: baseMulta, multaPct: T.multa, multa: multa,
              saquePct: T.saque, saque: saque, total: fgtsTotal },
      totalGeral: r2(liquido + fgtsTotal)
    };
  }

  var api = { TAB: TAB, TIPOS: TIPOS, calcular: calcular, inss: inss, irrf: irrf, anosCompletos: anosCompletos, P: P, r2: r2 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Rescisao = api;
})(typeof window !== "undefined" ? window : this);
