import React, { Component } from "react";
import { Device, Cluster, Endpoint, Attribute } from "../../types";

import actions, { ReportingApi } from "../../actions";
import { connect } from "unistore/react";
import { GlobalState, Group } from "../../store";
import ReportingRow from "./reporting-row";


interface PropsFromStore {
    devices: Map<string, Device>;
    groups: Group[];
}
interface ReportingProps {
    device: Device;
}

export interface NiceReportingingRule {
    id?: number;
    isNew?: number;
    endpoint: Endpoint;

    cluster: Cluster;
    attribute: Attribute;
    minimum_report_interval: number;
    maximum_report_interval: number;
    reportable_change: number;
}
const convertBidningsIntoNiceStructure = (device: Device): NiceReportingingRule[] => {
    const reportings: NiceReportingingRule[] = [];
    device.endpoints.forEach((description, endpoint) => {
        description.configured_reportings
            .forEach(reportingRule => {
                reportings.push({
                    ...reportingRule,
                    endpoint
                } as NiceReportingingRule)
            });
    });
    return reportings;
}
type ReportingState = {
    reportingRules: NiceReportingingRule[];
}

const rule2key = (rule: NiceReportingingRule): string => `${rule.isNew}${rule.cluster}-${rule.attribute}`;

export class Reporting extends Component<ReportingProps & PropsFromStore & ReportingApi, ReportingState> {
    state: ReportingState = {
        reportingRules: []
    }
    static getDerivedStateFromProps(props: Readonly<ReportingProps & PropsFromStore>): Partial<ReportingState> {
        const { device } = props;
        // const endpoints = getEndpoints(device);
        const reportingRules = convertBidningsIntoNiceStructure(device);

        // eslint-disable-next-line @typescript-eslint/camelcase
        reportingRules.push({ isNew: Date.now(), reportable_change: 0, minimum_report_interval: 60, maximum_report_interval: 3600 } as NiceReportingingRule);
        return {
            reportingRules
        };
    }

    onApply = (rule: NiceReportingingRule) => {
        const { configureReport, device } = this.props;
        // eslint-disable-next-line @typescript-eslint/camelcase
        const { cluster, endpoint, attribute, minimum_report_interval, maximum_report_interval, reportable_change } = rule;
        configureReport(`${device.friendly_name}/${endpoint}`, {
            // eslint-disable-next-line @typescript-eslint/camelcase
            cluster, attribute, minimum_report_interval, maximum_report_interval, reportable_change
        });
    }
    render() {
        const { device } = this.props;
        const { reportingRules } = this.state;

        return (
            <div className="table-responsive">
                <table className="table">
                    <thead>
                        <tr>
                            <th scope="col">#</th>
                            <th scope="col">Endpoint</th>
                            <th scope="col">Cluster</th>
                            <th scope="col">Attribute</th>
                            <th scope="col">Min rep interval</th>
                            <th scope="col">Max rep interval</th>
                            <th scope="col">Min rep change</th>
                            <th scope="col">&nbsp;</th>
                        </tr>
                    </thead>
                    <tbody>
                        {
                            reportingRules.map((rule, idx) =>
                                <ReportingRow
                                    key={rule2key(rule)}
                                    idx={idx}
                                    rule={rule}
                                    device={device}
                                    onApply={this.onApply}
                                />)
                        }
                    </tbody>

                </table>
            </div>
        );
    }
}

const mappedProps = ["devices", "groups"];
const ConnectedReportingPage = connect<ReportingProps, {}, GlobalState, PropsFromStore & ReportingApi>(mappedProps, actions)(Reporting);
export default ConnectedReportingPage