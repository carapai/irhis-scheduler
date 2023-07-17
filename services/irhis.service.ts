/* eslint-disable no-param-reassign */
/* eslint-disable no-useless-escape */
/* eslint-disable @typescript-eslint/require-await */
import type { AxiosInstance } from "axios";
import axios from "axios";
import dayjs from "dayjs";
import { fromPairs } from "lodash";
import { evaluate } from "mathjs";
import type { Service, ServiceSchema } from "moleculer";
import { scheduleJob } from "node-schedule";
import facilities from "./facilities.json";
import mapping from "./mapping.json";

export interface Facility {
	"DHIS2 UID": string;
	Settlement: string;
	HF: string;
	Level: string;
	"iRHIS ID": string;
}

interface SchedulerSettings {
	defaultName: string;
}

interface SchedulerMethods {
	uppercase(str: string): string;
}

interface SchedulerLocalVars {
	myVar: string;
}

type SchedulerThis = Service<SchedulerSettings> & SchedulerMethods & SchedulerLocalVars;

const SchedulerService: ServiceSchema<SchedulerSettings> = {
	name: "ihris",

	/**
	 * Settings
	 */
	settings: {
		defaultName: "Moleculer",
	},

	/**
	 * Dependencies
	 */
	dependencies: [],

	/**
	 * Actions
	 */
	actions: {},

	/**
	 * Events
	 */
	events: {},

	/**
	 * Methods
	 */
	methods: {
		createAPI() {
			return axios.create({
				baseURL: process.env.DHIS2_URL || "",
				auth: {
					username: process.env.DHIS2_USERNAME || "",
					password: process.env.DHIS2_PASSWORD || "",
				},
			});
		},
		async fetchData(api: AxiosInstance, orgUnit: string, period: string) {
			const allParams = new URLSearchParams();
			allParams.append("dataSet", "RtEYsASU7PG");
			allParams.append("dataSet", "ic1BSWhGOso");
			allParams.append("dataSet", "nGkMm2VBT4G");
			allParams.append("dataSet", "VDhwrW9DiC1");
			allParams.append("dataSet", "quMWqLxzcfO");
			allParams.append("dataSet", "GyD9wEs2NYG");
			allParams.append("dataSet", "EBqVAQRmiPm");
			allParams.append("orgUnit", orgUnit);
			allParams.append("period", period);
			const url = `dataValueSets.json?${allParams.toString()}`;
			const data = await api.get(url);
			return data;
		},
		processData(allValues: { [key: string]: string }) {
			return fromPairs(
				mapping.map(({ key, value }) => {
					let attribute = "";
					if (key.indexOf("_Ref") !== -1) {
						attribute = "TFRceXDkJ95";
					} else if (key.indexOf("_Nat")) {
						attribute = "Lf2Axb9E6B4";
					}

					if (value === "0") {
						return [key, 0];
					}
					if (value) {
						const splitString = value.split(/\+|\-/);
						splitString.forEach((val) => {
							value = value.replace(val, allValues[`${val}.${attribute}`] || "0");
						});
						let val = 0;
						try {
							val = evaluate(value);
						} catch (error) {
							this.logger.error(key, value);
							this.logger.error(error);
						}
						return [key, val];
					}
					return [key, 0];
				}),
			);
		},
		async postToIRHIS({
			payload,
			facility,
			startDate,
			endDate,
		}: {
			payload: { [key: string]: number | string };
			facility: Facility;
			startDate: string;
			endDate: string;
		}) {
			try {
				const api = this.createAPI();
				const {
					data: { baseURL, username, password },
				} = await api.get("dataStore/irhis/user");

				const instance = axios.create({
					baseURL,
				});

				const {
					data: { access },
				} = await instance.post("auth/jwt/create", {
					username,
					password,
				});

				const {
					data: { results },
				} = await instance.post(
					"users/user/query/",
					{ selector: { username }, fields: ["id"] },
					{
						headers: {
							Authorization: `Bearer ${access}`,
							"Content-Type": "application/json",
						},
					},
				);
				if (results.length > 0) {
					const [{ id }] = results;
					const finalPayload = {
						user: id,
						schema: 96,
						data: payload,
						timelevel: 3,
						location: Number(facility["iRHIS ID"]),
						date_start: startDate,
						date_end: endDate,
					};
					if (access) {
						await instance.post("reports/form_data/", finalPayload, {
							headers: {
								Authorization: `Bearer ${access}`,
								"Content-Type": "application/json",
							},
						});
						return { ...facility, status: 200, date: dayjs().toISOString() };
					}
				} else {
					return { ...facility, status: 403, date: dayjs().toISOString() };
				}
			} catch (error) {
				this.logger.error(error.message);
				return { ...facility, status: error.response.status, date: dayjs().toISOString() };
			}
			return { ...facility, date: dayjs().toISOString() };
		},
	},

	/**
	 * Service created lifecycle event handler
	 */
	created(this: SchedulerThis) {},

	/**
	 * Service started lifecycle event handler
	 */
	async started(this: SchedulerThis) {
		scheduleJob("cases", "*/30 * * * * *", async () => {
			const api = this.createAPI();
			let previous: object[] = [];
			try {
				const { data } = await api.get("dataStore/irhis/previous");
				previous = data;
			} catch (error) {
				this.logger.error(error.message);
			}

			for (const facility of facilities) {
				const {
					data: { dataValues },
				} = await this.fetchData(
					api,
					facility["DHIS2 UID"],
					dayjs().subtract(1, "month").format("YYYYMM"),
				);

				if (dataValues) {
					const allValues = fromPairs<string>(
						dataValues.map(
							({
								dataElement,
								categoryOptionCombo,
								attributeOptionCombo,
								value,
							}: never) => [
								`${dataElement}.${categoryOptionCombo}.${attributeOptionCombo}`,
								value,
							],
						),
					);
					const payload = this.processData(allValues);
					const startDate = dayjs()
						.subtract(1, "month")
						.startOf("month")
						.startOf("week")
						.add(3, "hours")
						.format("YYYY-MM-DD");
					const endDate = dayjs()
						.subtract(1, "month")
						.startOf("month")
						.endOf("week")
						.format("YYYY-MM-DD");

					const response = await this.postToIRHIS({
						payload,
						facility,
						startDate,
						endDate,
					});
					this.logger.info(response);
					previous = [...previous, response];
					await api.put("dataStore/irhis/previous", previous);
				}
			}
		});
	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped(this: SchedulerThis) {},
};

export default SchedulerService;
