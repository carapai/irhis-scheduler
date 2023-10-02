/* eslint-disable no-param-reassign */
/* eslint-disable no-useless-escape */
/* eslint-disable @typescript-eslint/require-await */
import type { AxiosInstance } from "axios";
import axios from "axios";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import updateLocale from "dayjs/plugin/updateLocale";
import utc from "dayjs/plugin/utc";
import weekday from "dayjs/plugin/weekday";
import { fromPairs, groupBy, isEmpty, maxBy, minBy } from "lodash";
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

dayjs.extend(weekday);
dayjs.extend(isoWeek);
dayjs.extend(updateLocale);
dayjs.updateLocale("en", {
	weekStart: 1,
});
dayjs.extend(utc);

const getDatesBetween = (start: Date, end: Date) => {
	const all: Date[] = [];
	for (let dt = new Date(start); dt <= new Date(end); dt.setDate(dt.getDate() + 1)) {
		all.push(new Date(dt));
	}
	return all;
};
const processDates = (arr: Date[]) => {
	const all = arr.map((d) => ({ date: dayjs(d).format("YYYY-MM-DD") }));
	const minMonth = minBy(all, (d) => d.date.slice(0, 7));
	const maxMonth = maxBy(all, (d) => d.date.slice(0, 7));
	const groups = groupBy(all, (d) => d.date.slice(0, 7));

	if (
		groups[String(minMonth?.date.slice(0, 7))]?.length <=
		groups[String(maxMonth?.date.slice(0, 7))]?.length
	) {
		return [
			dayjs(arr[0]).format("YYYY-MM-DD"),
			dayjs(arr[arr.length - 1]).format("YYYY-MM-DD"),
		];
	}

	return [
		dayjs(arr[0]).add(7, "days").format("YYYY-MM-DD"),
		dayjs(arr[arr.length - 1])
			.add(7, "days")
			.format("YYYY-MM-DD"),
	];
};

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
		async fetchData(api: AxiosInstance, orgUnit: string, period: [string, string]) {
			const previousPeriod = dayjs(period[0]).subtract(1, "months");
			const prevStartDate = previousPeriod.startOf("month").format("YYYY-MM-DD");
			const prevEndDate = previousPeriod.endOf("month").format("YYYY-MM-DD");
			const prevParameters = new URLSearchParams();
			prevParameters.append("orgUnit", orgUnit);
			prevParameters.append("startDate", prevStartDate);
			prevParameters.append("endDate", prevEndDate);
			prevParameters.append(
				"dataSet",
				[
					"RtEYsASU7PG",
					"ic1BSWhGOso",
					"nGkMm2VBT4G",
					"VDhwrW9DiC1",
					"quMWqLxzcfO",
					"GyD9wEs2NYG",
					"EBqVAQRmiPm",
				].join(","),
			);
			const allParams = new URLSearchParams();

			allParams.append(
				"dataSet",
				[
					"RtEYsASU7PG",
					"ic1BSWhGOso",
					"nGkMm2VBT4G",
					"VDhwrW9DiC1",
					"quMWqLxzcfO",
					"GyD9wEs2NYG",
					"EBqVAQRmiPm",
				].join(","),
			);
			allParams.append("orgUnit", orgUnit);
			allParams.append("startDate", period[0]);
			allParams.append("endDate", period[1]);
			const url = `dataValueSets.json?${allParams.toString()}`;
			const url2 = `dataValueSets.json?${prevParameters.toString()}`;
			const [
				{
					data: { dataValues },
				},
				{
					data: { dataValues: dataValues1 },
				},
			] = await Promise.all([api.get(url), api.get(url2)]);
			return { allDataValues: dataValues || {}, allPrevDataValues: dataValues1 || {} };
		},
		processData(
			allValues: { [key: string]: string },
			allValuesPrev: { [key: string]: string },
			period: [string, string],
		) {
			return fromPairs(
				mapping.map(({ key, value }) => {
					let actualValue = String(value);
					let attribute = "";
					if (
						["OPD_TS_oar_nr_outbreaks_rep", "OPD_TS_oar_nr_rep_invest"].indexOf(
							String(key),
						) !== -1
					) {
						attribute = "HllvX50cXC0";
					} else if (String(key).indexOf("_Ref") !== -1) {
						attribute = "TFRceXDkJ95";
					} else if (String(key).indexOf("_Nat") !== -1) {
						attribute = "Lf2Axb9E6B4";
					}

					let workingWith = allValues;

					if (key.indexOf("beginning_of_reporting_period") !== -1) {
						workingWith = allValuesPrev;
					}
					if (value === "0" || value === 0) {
						if (
							[
								"IPD_TS_Ind_ipd_reporting_period_days",
								"OPD_TS_Ind_full_days_OPD_functioning",
							].indexOf(key) !== -1
						) {
							return [
								key,
								{
									value: dayjs(period[0]).daysInMonth(),
									expression: "0",
								},
							];
						}
						return [key, { value: "0", expression: "0" }];
					}
					if (String(value) && attribute) {
						let value2 = actualValue;
						const splitString = String(value).split(/\+|\-/);
						const splitString2 = String(value2).split(/\+|\-/);

						splitString.forEach((val) => {
							actualValue = actualValue.replace(
								val,
								workingWith[`${val}.${attribute}`] || "0",
							);
						});

						splitString2.forEach((val) => {
							value2 = value2.replace(
								val,
								`${workingWith[`${val}.${attribute}`] || "0"}`,
							);
						});
						let val = 0;
						try {
							val = evaluate(actualValue);
						} catch (error) {
							this.logger.error(key, value);
							this.logger.error(error);
						}
						return [key, { value: val, expression: value2 }];
					}
					let national = String(value);
					let refugee = String(value);

					const natSplit = national.split(/\+|\-/);
					const refSplit = refugee.split(/\+|\-/);

					natSplit.forEach((val) => {
						national = national.replace(val, workingWith[`${val}.Lf2Axb9E6B4`] || "0");
					});

					refSplit.forEach((val) => {
						refugee = refugee.replace(val, workingWith[`${val}.TFRceXDkJ95`] || "0");
					});

					try {
						const natValue = evaluate(national);
						const refValue = evaluate(refugee);
						return [
							key,
							{
								value:
									key === "IPD_TS_nr_beds"
										? refValue
										: String(Number(natValue) + Number(refValue)),
								expression: "",
							},
						];
					} catch (error) {
						this.logger.error(key, value);
						this.logger.error(error);
					}
					return [key, { value: "0", expression: "0" }];
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
						schema: 143,
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
		scheduleJob("cases", "0 0 * * *", async () => {
			const api = this.createAPI();
			let previous: object[] = [];
			const prevMonth = dayjs().subtract(1, "month");
			const period = [
				prevMonth.startOf("month").format("YYYY-MM-DD"),
				prevMonth.endOf("month").format("YYYY-MM-DD"),
			];
			const startDate = dayjs(period[0]).startOf("week");
			const endDate = dayjs(period[0]).endOf("week");

			const [start, end] = processDates(
				getDatesBetween(startDate.toDate(), endDate.toDate()),
			);
			try {
				const { data } = await api.get("dataStore/irhis/previous");
				previous = data;
			} catch (error) {
				this.logger.error(error.message);
			}

			for (const facility of facilities) {
				const { allDataValues, allPrevDataValues } = await this.fetchData(
					api,
					facility["DHIS2 UID"],
					period,
				);

				let allValues: { [key: string]: string } = {};
				let allValuesPrev: { [key: string]: string } = {};
				if (!isEmpty(allDataValues)) {
					allValues = fromPairs<string>(
						allDataValues.map(
							({
								dataElement,
								categoryOptionCombo,
								attributeOptionCombo,
								value,
							}: {
								dataElement: string;
								categoryOptionCombo: string;
								attributeOptionCombo: string;
								value: string;
							}) => [
								`${dataElement}.${categoryOptionCombo}.${attributeOptionCombo}`,
								value,
							],
						),
					);
				}

				if (!isEmpty(allPrevDataValues)) {
					allValuesPrev = fromPairs<string>(
						allPrevDataValues.map(
							({
								dataElement,
								categoryOptionCombo,
								attributeOptionCombo,
								value,
							}: {
								dataElement: string;
								categoryOptionCombo: string;
								attributeOptionCombo: string;
								value: string;
							}) => [
								`${dataElement}.${categoryOptionCombo}.${attributeOptionCombo}`,
								value,
							],
						),
					);
				}

				const payload = this.processData(allValues, allValuesPrev, period);

				const finalPayload = Object.entries<{ value: string | number }>(payload)
					.filter(([key]) => key && key !== "0")
					.map(([key, value]) => [key, Number(value.value)]);

				const response = await this.postToIRHIS({
					payload: finalPayload,
					facility,
					startDate: start,
					endDate: end,
				});
				previous = [...previous, response];
				await api.put("dataStore/irhis/previous", previous);
			}
		});
	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped(this: SchedulerThis) {},
};

export default SchedulerService;
