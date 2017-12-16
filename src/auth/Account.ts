import Network from "core/Network";
import Parser from "core/Parser";
import Discipline from "models/Discipline";
import Evaluation from "models/Evaluation";
import Student from "models/Student";

export default class Account {

  private static readonly STATES = {
    DENIED: 1,
    IDLE: 0,
    LOGGED: 2,
  };

  public username: string;
  public password: string;
  public cookie: string = "";
  public state: number = Account.STATES.IDLE;

  public student: Student = new Student();

  constructor (username: string, password: string) {
    this.username = username;
    this.password = password;
  }

  public isLogged (): boolean {
    return this.state === Account.STATES.LOGGED;
  }

  public isDenied (): boolean {
    return this.state === Account.STATES.DENIED;
  }

  public isIdle (): boolean {
    return this.state === Account.STATES.IDLE;
  }

  public login (): Promise<any> {
    return Network.post({
      form: {
        vSIS_USUARIOID: this.username,
        vSIS_USUARIOSENHA: this.password,
      },
      route: Network.ROUTES.LOGIN,
    }).then((res) => {
      // No redirect means no login
      this.state = Account.STATES.DENIED;
    }).catch((err) => {
      if (err.statusCode === Network.STATUS.REDIRECT) {
        this.state = Account.STATES.LOGGED;
        this.cookie = Network.getCookieFromResponse(err.response);
      } else {
        this.state = Account.STATES.DENIED;
      }
    });
  }

  public getName (): Promise<string> {
    return Network.scrap({
      cookie: this.cookie,
      route: Network.ROUTES.HOME,
      scrapper: ($) => {
        this.student.setName($("#span_MPW0039vPRO_PESSOALNOME").text());
        return this.student.getName();
      },
    });
  }

  public getRegisteredEmails (): Promise<object> {
    if (this.student.getRegisteredEmails()) {
      return Promise.resolve(this.student.getRegisteredEmails());
    }
    return Network.scrap({
      cookie: this.cookie,
      route: Network.ROUTES.HOME,
      scrapper: ($$) => {
        const iFrameSrc = $$('[name="Embpage1"]').attr("src");
        return Network.scrap({
          cookie: this.cookie,
          route: iFrameSrc,
          scrapper: ($) => {
            const emailIntegrations = ["fatec", "etec", "preferential", "websai"];
            const tableData = JSON.parse($("[name=Grid1ContainerDataV]").val());
            this.student.setRegisteredEmails(tableData.map((line) => {
              return {
                email: line[0],
                integrations: line.slice(3, line.length).reduce((integrations, isIntegrated, index) => {
                  if (isIntegrated === "1") {
                    integrations.push(emailIntegrations[index]);
                  }
                  return integrations;
                }, []),
              };
            }));
            return this.student.getRegisteredEmails();
          },
        });
      },
    });
  }

  public getPartialGrades (): Promise<object> {
    if (this.student.getPartialGrades()) {
      return Promise.resolve(this.student.getPartialGrades());
    }
    return Network.scrap({
      cookie: this.cookie,
      route: Network.ROUTES.PARTIAL_GRADES,
      scrapper: ($) => {
        const tag = $("[name=GXState]");
        let data = $("[name=GXState]").val();
        data = JSON.parse(data.replace(/\\>/g, "&gt")).Acd_alunonotasparciais_sdt;
        this.student.setPartialGrades(data.map((line) => {
          return {
            approved: Parser.nBoolean(line["ACD_AlunoHistoricoItemAprovada"]),
            discipline: new Discipline({
              classRoomId: line["ACD_AlunoHistoricoItemTurmaId"],
              code: line["ACD_DisciplinaSigla"],
              courseId: line["ACD_CursoId"],
              name: line["ACD_DisciplinaNome"],
              periodId: line["ACD_Periodoid"],
              quitDate: Parser.strDate(line["ACD_AlunoHistoricoItemDesistenciaData"]),
              teacherId: line["ACD_AlunoHistoricoItemProfessorId"],
            }),
            evaluations: line["Avaliacoes"].map((evaluation) => {
              return new Evaluation({
                applyDates: {
                  applied: Parser.strDate(evaluation["ACD_PlanoEnsinoAvaliacaoDataProva"]),
                  predicted: Parser.strDate(evaluation["ACD_PlanoEnsinoAvaliacaoDataPrevista"]),
                  published: Parser.strDate(evaluation["ACD_PlanoEnsinoAvaliacaoDataPublicacao"]),
                },
                code: evaluation["ACD_PlanoEnsinoAvaliacaoSufixo"],
                description: evaluation["ACD_PlanoEnsinoAvaliacaoDescricao"],
                grades: evaluation.Notas.map((grade) => {
                  return {
                    date: Parser.strDate(grade["ACD_PlanoEnsinoAvaliacaoParcialDataLancamento"]),
                    score: grade["ACD_PlanoEnsinoAvaliacaoParcialNota"],
                  };
                }),
                title: evaluation["ACD_PlanoEnsinoAvaliacaoTitulo"],
                weight: Parser.strNumber(evaluation["ACD_PlanoEnsinoAvaliacaoPeso"]),
              });
            }),
            finalScore: line["ACD_AlunoHistoricoItemMediaFinal"],
            frequency: line["ACD_AlunoHistoricoItemFrequencia"],
          };
        }));
        return this.student.getPartialGrades();
      },
    });
  }

  public getEnrolledDisciplines (): Promise<object> {
    return Network.scrap({
      cookie: this.cookie,
      route: Network.ROUTES.PARTIAL_ABSENSES,
      scrapper: ($$) => {
        let data = $$("[name=GXState]").val();
        data = JSON.parse(data.replace(/\\>/g, "&gt")).vFALTAS;

        return Network.scrap({
          cookie: this.cookie,
          route: Network.ROUTES.SCHEDULE,
          scrapper: ($) => {
            let scheduleData = $("[name=GXState]").val();
            scheduleData = JSON.parse(scheduleData.replace(/\\>/g, "&gt")).vALU_ALUNOHISTORICOITEM_SDT;
            this.student.setEnrolledDisciplines(data.map((line) => {
              const scheduleDiscipline = scheduleData.filter((d) => {
                return d["ACD_DisciplinaSigla"] === line["ACD_DisciplinaSigla"].trim();
              })[0];

              return new Discipline({
                absenses: line["TotalAusencias"],
                classRoomCode: scheduleDiscipline["ACD_TurmaLetra"],
                classRoomId: line["ACD_AlunoHistoricoItemTurmaId"],
                code: line["ACD_DisciplinaSigla"].trim(),
                courseId: line["ACD_AlunoHistoricoItemCursoId"],
                name: line["ACD_DisciplinaNome"],
                periodId: line["ACD_Periodoid"],
                presences: line["TotalPresencas"],
                teacherId: line["ACD_AlunoHistoricoItemProfessorId"],
                teacherName: scheduleDiscipline["Pro_PessoalNome"],
              });
            }));
            return this.student.getEnrolledDisciplines();
          },
        });
      },
    });
  }
}
